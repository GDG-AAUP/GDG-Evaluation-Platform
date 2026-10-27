from __future__ import annotations

import time
from dataclasses import dataclass, field

from google import genai
from google.genai import errors, types

from . import config
from .prompts import build_system_prompt
from .tools import TOOL_SPECS, ToolExecutor


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
            temperature=0.2,    # low = more consistent, less creative (good for factual answers)
        )
        self.history: list[types.Content] = []

    def _generate(self):
        """Call Gemini. 503 = Google is busy, 429 = quota/rate limit: wait and retry a few times, then give up."""
        wait = 5
        for attempt in range(config.LLM_RETRIES):
            try:
                return self.client.models.generate_content(model=self.model, contents=self.history, config=self.config)
            except errors.APIError as e:
                if getattr(e, "code", None) in (429, 503) and attempt < config.LLM_RETRIES - 1:
                    time.sleep(wait)
                    wait *= 2          # 5s, 10s, 20s ...
                    continue
                raise

    def ask(self, text: str) -> Turn:
        """One question. If ANYTHING fails (Gemini down, quota, network...), the history is rolled back to
        how it was before this question, so a failed question never pollutes the next one."""
        start = len(self.history)
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
