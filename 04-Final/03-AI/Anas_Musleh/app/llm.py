from __future__ import annotations

import logging
import re
import threading
import time
from dataclasses import dataclass, field

import httpx
from google import genai
from google.genai import errors, types

from . import config
from .prompts import build_system_prompt
from .tools import TOOL_SPECS, ToolExecutor

logger = logging.getLogger("gdg.chatbot")

# Failures that another model may not share: busy, rate-limited, retired, or server-side errors.
TRY_NEXT_MODEL = {404, 429, 500, 503, 504}


class ModelsUnavailable(Exception):
    """Every model is cooling down (quota used up / overloaded): fail at once instead of re-asking Google."""

    def __init__(self, quota: bool):
        super().__init__("all Gemini models are cooling down")
        self.quota = quota


# Process-wide model health, shared by every request. Without it each question re-tried every model
# from the top, including ones that had just answered 429 "daily quota exceeded": slow, then a failure.
_health_lock = threading.Lock()
_cooldown_until: dict[str, float] = {}     # model -> monotonic time it may be tried again
_cooldown_quota: set[str] = set()          # models cooling down because of 429
_no_thinking: set[str] = set()             # models that reject thinking_level
_preferred: list[str] = []                 # the model that answered last goes first


def reset_model_health() -> None:
    with _health_lock:
        _cooldown_until.clear()
        _cooldown_quota.clear()
        _no_thinking.clear()
        _preferred.clear()


def _retry_after_seconds(error: Exception) -> float | None:
    """Google's RetryInfo ('retryDelay': '63590s') or 'Please retry in 17h39m50s'."""
    text = " ".join(str(x or "") for x in (getattr(error, "message", ""), getattr(error, "details", ""), error))
    match = re.search(r"retryDelay['\"]?\s*[:=]\s*['\"]?(\d+(?:\.\d+)?)s", text)
    if match:
        return float(match.group(1))
    match = re.search(r"retry in (?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?", text)
    if match and any(match.groups()):
        h, m, s = (float(g) if g else 0.0 for g in match.groups())
        return h * 3600 + m * 60 + s
    return None


def _cool_down(model: str, error: Exception | None) -> None:
    code = getattr(error, "code", None)
    if code == 429:
        seconds = min(_retry_after_seconds(error) or 60.0, 6 * 3600)
    elif code == 404:
        seconds = 3600.0                    # retired / not offered to this key
    else:
        seconds = 30.0                      # 5xx overload or a timeout: short pause
    with _health_lock:
        _cooldown_until[model] = time.monotonic() + seconds
        if code == 429:
            _cooldown_quota.add(model)
        else:
            _cooldown_quota.discard(model)


def _available(models: list[str]) -> list[str]:
    now = time.monotonic()
    with _health_lock:
        return [m for m in models if _cooldown_until.get(m, 0.0) <= now]


def _mark_working(model: str) -> None:
    with _health_lock:
        _cooldown_until.pop(model, None)
        _cooldown_quota.discard(model)
        _preferred[:] = [model]


def model_chain() -> list[str]:
    return list(dict.fromkeys([config.GEMINI_MODEL, *config.GEMINI_FALLBACK_MODELS]))


def describe(error: Exception | None) -> str:
    code = getattr(error, "code", None)
    return f"{code} {getattr(error, 'status', '')}".strip() if code else type(error).__name__


def build_declarations() -> list[types.FunctionDeclaration]:
    decls = []
    for spec in TOOL_SPECS:
        props = {k: {**v, "type": v["type"].upper()} for k, v in spec["properties"].items()}
        schema = {"type": "OBJECT", "properties": props}
        if spec["required"]:
            schema["required"] = spec["required"]
        decls.append(types.FunctionDeclaration(
            name=spec["name"], description=spec["description"],
            parameters=schema if props else None))
    return decls


@dataclass
class Turn:
    """What happened in one question: used by the CLI and by the evals."""
    answer: str
    tool_calls: list[dict] = field(default_factory=list)   # [{name, args, result}]


class Assistant:
    def __init__(self, executor: ToolExecutor, api_key: str | None = None, model: str | None = None):
        me = executor.me()
        self.executor = executor
        self.model = model or config.GEMINI_MODEL
        self.client = genai.Client(api_key=api_key or config.GEMINI_API_KEY)
        self.config = types.GenerateContentConfig(
            system_instruction=build_system_prompt(executor.today, me["name"], me["role"]),
            tools=[types.Tool(function_declarations=build_declarations())],
            # We run the tools ourselves (more control + easier to learn and to audit).
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            temperature=config.GEMINI_TEMPERATURE,   # low = consistent, factual answers
            max_output_tokens=config.GEMINI_MAX_OUTPUT_TOKENS,
            thinking_config=(types.ThinkingConfig(thinking_level=config.GEMINI_THINKING_LEVEL)
                             if config.GEMINI_THINKING_LEVEL else None),
            http_options=types.HttpOptions(timeout=config.GEMINI_TIMEOUT_MS),
        )
        self.history: list[types.Content] = []
        self._deadline: float | None = None

    def _candidates(self) -> list[str]:
        """The last model that answered (in any request) first, then the chain; models cooling down are skipped."""
        with _health_lock:
            preferred = list(_preferred)
        ordered = list(dict.fromkeys([*preferred, self.model, *model_chain()]))
        return _available(ordered)

    def _config_for(self, model: str):
        if model in _no_thinking and self.config.thinking_config is not None:
            return self.config.model_copy(update={"thinking_config": None})
        return self.config

    def _call(self, model: str):
        response = self.client.models.generate_content(model=model, contents=self.history,
                                                       config=self._config_for(model))
        self.model = model
        _mark_working(model)
        return response

    def _generate(self):
        """Call Gemini, moving to the next model when one is busy (503), rate-limited (429), retired (404)
        or too slow; after a full pass with no answer, wait briefly and try the list again."""
        wait = 5
        last_error: Exception | None = None
        for attempt in range(max(1, config.LLM_RETRIES)):
            candidates = self._candidates()
            if not candidates:
                with _health_lock:
                    quota = bool(_cooldown_quota)
                raise last_error or ModelsUnavailable(quota)
            for model in candidates:
                if self._deadline and time.monotonic() > self._deadline:
                    raise last_error or TimeoutError("chat deadline reached")
                try:
                    return self._call(model)
                except errors.APIError as e:
                    error = e
                    if self._thinking_unsupported(model, e):
                        try:
                            return self._call(model)
                        except errors.APIError as again:
                            error = again
                    if getattr(error, "code", None) not in TRY_NEXT_MODEL:
                        raise error
                    last_error = error
                except httpx.TimeoutException as e:
                    last_error = e
                _cool_down(model, last_error)
                logger.warning("Gemini model %s failed (%s); trying the next one", model, describe(last_error))
            if attempt < config.LLM_RETRIES - 1:
                time.sleep(wait)
                wait *= 2
        raise last_error

    def _thinking_unsupported(self, model: str, error: errors.APIError) -> bool:
        """A model that rejects the thinking setting (400) is remembered and retried at once without it."""
        if (getattr(error, "code", None) == 400 and self.config.thinking_config is not None
                and model not in _no_thinking
                and "think" in str(getattr(error, "message", "") or "").lower()):
            logger.warning("Model %s rejected thinking_level=%s; using its default from now on",
                           model, config.GEMINI_THINKING_LEVEL)
            with _health_lock:
                _no_thinking.add(model)
            return True
        return False

    def ask(self, text: str) -> Turn:
        """One question. If ANYTHING fails (Gemini down, quota, network...), the history is rolled back to
        how it was before this question, so a failed question never pollutes the next one."""
        start = len(self.history)
        self._deadline = time.monotonic() + config.CHAT_DEADLINE_S
        self.history.append(types.Content(role="user", parts=[types.Part(text=text)]))
        trace: list[dict] = []
        try:
            for _ in range(config.MAX_TOOL_ROUNDS):
                resp = self._generate()
                calls = resp.function_calls or []
                if not calls:
                    answer = (resp.text or "").strip() or "عذراً، ما قدرت أجهّز إجابة. جرّب تعيد صياغة السؤال."
                    self.history.append(types.Content(role="model", parts=[types.Part(text=answer)]))
                    return Turn(answer, trace)
                self.history.append(resp.candidates[0].content)          # the model's tool request
                parts = []
                for call in calls:
                    args = dict(call.args or {})
                    result = self.executor.run(call.name, args)          # OUR code runs the tool
                    trace.append({"name": call.name, "args": args, "result": result})
                    parts.append(types.Part.from_function_response(name=call.name, response=result))
                self.history.append(types.Content(role="user", parts=parts))
            msg = "الطلب احتاج خطوات أكثر من المسموح. جرّب سؤالاً أبسط أو أكثر تحديداً."
            self.history.append(types.Content(role="model", parts=[types.Part(text=msg)]))
            return Turn(msg, trace)
        except BaseException:
            del self.history[start:]          # drop the unanswered question and any half-finished tool turns
            raise
