"""Tests the tool-calling LOOP with a fake model (no internet / no key needed)."""
from datetime import date
from types import SimpleNamespace

from google.genai import types

from app import llm
from app.mock_backend import MockBackend
from app.tools import ToolExecutor


class FakeModels:
    """Round 1: 'call get_my_points'. Round 2: answer using the tool result."""

    def __init__(self):
        self.calls = 0
        self.seen_results = []

    def generate_content(self, model, contents, config):
        self.calls += 1
        if self.calls == 1:
            fc = SimpleNamespace(name="get_my_points", args={"month": 10, "year": 2026})
            content = types.Content(role="model", parts=[types.Part(function_call=types.FunctionCall(name="get_my_points", args={"month": 10, "year": 2026}))])
            return SimpleNamespace(function_calls=[fc], candidates=[SimpleNamespace(content=content)], text=None)
        last = contents[-1].parts[0].function_response.response
        self.seen_results.append(last)
        total = last["data"]["totalPointsInPeriod"]
        return SimpleNamespace(function_calls=None, candidates=[], text=f"حصلت على {total} نقطة")


def make(monkeypatch):
    fake = FakeModels()
    monkeypatch.setattr(llm.genai, "Client", lambda api_key=None: SimpleNamespace(models=fake))
    ex = ToolExecutor(MockBackend(), "mock-ahmad", date(2026, 10, 23))
    return llm.Assistant(ex, api_key="x"), fake


def test_loop_runs_tool_then_answers(monkeypatch):
    bot, fake = make(monkeypatch)
    turn = bot.ask("كم نقطة حصلت هذا الشهر؟")
    assert turn.answer == "حصلت على 25 نقطة"
    assert [t["name"] for t in turn.tool_calls] == ["get_my_points"]
    assert fake.calls == 2


def test_system_prompt_has_date_role_and_readonly(monkeypatch):
    bot, _ = make(monkeypatch)
    sp = bot.config.system_instruction
    assert "2026-10-23" in sp and "READ-ONLY" in sp and "Role: member" in sp
    assert "token" not in sp.lower()           # the model never sees credentials


def test_busy_model_falls_back_to_the_next_one(monkeypatch):
    from google.genai import errors

    bot, fake = make(monkeypatch)
    monkeypatch.setattr(llm.config, "GEMINI_MODEL", "busy-model")
    monkeypatch.setattr(llm.config, "GEMINI_FALLBACK_MODELS", ["spare-model"])
    bot.model = "busy-model"
    tried = []
    real = fake.generate_content

    def generate(model, contents, config):
        tried.append(model)
        if model == "busy-model":
            raise errors.ServerError(503, {"error": {"code": 503, "message": "high demand", "status": "UNAVAILABLE"}})
        return real(model, contents, config)

    fake.generate_content = generate
    turn = bot.ask("كم نقطة حصلت هذا الشهر؟")
    assert turn.answer == "حصلت على 25 نقطة"
    assert tried == ["busy-model", "spare-model", "spare-model"]   # sticks to the model that answered


def test_invalid_key_is_not_retried_on_other_models(monkeypatch):
    from google.genai import errors

    bot, fake = make(monkeypatch)
    calls = []

    def generate(model, contents, config):
        calls.append(model)
        raise errors.ClientError(403, {"error": {"code": 403, "message": "API key not valid", "status": "PERMISSION_DENIED"}})

    fake.generate_content = generate
    try:
        bot.ask("x")
        raise AssertionError("expected the key error")
    except errors.ClientError:
        pass
    assert len(calls) == 1


def test_round_limit(monkeypatch):
    bot, fake = make(monkeypatch)
    monkeypatch.setattr(llm.config, "MAX_TOOL_ROUNDS", 2)
    fake.generate_content = lambda model, contents, config: SimpleNamespace(
        function_calls=[SimpleNamespace(name="get_my_points", args={})],
        candidates=[SimpleNamespace(content=types.Content(role="model", parts=[types.Part(text="x")]))], text=None)
    turn = bot.ask("loop")
    assert len(turn.tool_calls) == 2 and "خطوات" in turn.answer


def test_retry_on_503_then_success(monkeypatch):
    from google.genai import errors
    bot, fake = make(monkeypatch)
    monkeypatch.setattr(llm.time, "sleep", lambda s: None)
    real = fake.generate_content
    state = {"n": 0}

    def flaky(model, contents, config):
        state["n"] += 1
        if state["n"] <= 2:
            raise errors.ServerError(503, {"error": {"code": 503, "message": "busy", "status": "UNAVAILABLE"}})
        return real(model, contents, config)

    fake.generate_content = flaky
    assert bot.ask("x").tool_calls[0]["name"] == "get_my_points"


def test_gives_up_after_retries(monkeypatch):
    import pytest
    from google.genai import errors
    bot, fake = make(monkeypatch)
    monkeypatch.setattr(llm.time, "sleep", lambda s: None)

    def always429(model, contents, config):
        raise errors.ClientError(429, {"error": {"code": 429, "message": "quota", "status": "RESOURCE_EXHAUSTED"}})

    fake.generate_content = always429
    with pytest.raises(errors.ClientError):
        bot.ask("x")


# ---------- history must not keep a question whose answer failed (Maria's bug #1)
def _quota_error():
    from google.genai import errors
    return errors.ClientError(429, {"error": {"code": 429, "message": "quota", "status": "RESOURCE_EXHAUSTED"}})


def test_failed_question_leaves_no_trace_in_history(monkeypatch):
    import pytest
    bot, fake = make(monkeypatch)
    monkeypatch.setattr(llm.time, "sleep", lambda s: None)
    real, state = fake.generate_content, {"fail": True}

    def flaky(model, contents, config):
        if state["fail"]:
            raise _quota_error()
        return real(model, contents, config)

    fake.generate_content = flaky
    with pytest.raises(Exception):
        bot.ask("old question")
    assert bot.history == []                                  # nothing kept
    state["fail"] = False
    llm.reset_model_health()                                  # the quota window has passed
    turn = bot.ask("new question")
    assert turn.answer.startswith("حصلت")
    assert [c.role for c in bot.history] == ["user", "model", "user", "model"]
    assert bot.history[0].parts[0].text == "new question"     # the old question is gone


def test_failure_midway_rolls_back_the_tool_turns_too(monkeypatch):
    import pytest
    bot, fake = make(monkeypatch)
    monkeypatch.setattr(llm.time, "sleep", lambda s: None)
    real, n = fake.generate_content, {"c": 0}

    def f(model, contents, config):
        n["c"] += 1
        if n["c"] >= 2:                       # 1st call asks for a tool, then Gemini dies
            raise _quota_error()
        return real(model, contents, config)

    fake.generate_content = f
    with pytest.raises(Exception):
        bot.ask("question")
    assert bot.history == []


# ---------- latency settings
def test_generation_is_tuned_for_fast_factual_answers(monkeypatch):
    bot, _ = make(monkeypatch)
    assert bot.config.temperature <= 0.4
    assert bot.config.max_output_tokens == llm.config.GEMINI_MAX_OUTPUT_TOKENS
    assert bot.config.thinking_config.thinking_level.value == "MINIMAL"
    assert bot.config.http_options.timeout <= 15000           # fail fast, then fall back


def test_model_rejecting_the_thinking_setting_is_retried_without_it(monkeypatch):
    from google.genai import errors

    bot, fake = make(monkeypatch)
    real = fake.generate_content
    seen = []

    def generate(model, contents, config):
        seen.append(config.thinking_config)
        if config.thinking_config is not None:
            raise errors.ClientError(400, {"error": {"code": 400, "message": "thinking_level is not supported", "status": "INVALID_ARGUMENT"}})
        return real(model, contents, config)

    fake.generate_content = generate
    assert bot.ask("x").answer == "حصلت على 25 نقطة"
    assert seen[0] is not None and seen[1] is None



def test_models_out_of_quota_are_skipped_by_later_questions(monkeypatch):
    """The real failure: every question re-asked every exhausted model. Now one failed pass is enough;
    the next question fails at once with a quota code, without calling Google again."""
    import pytest
    from google.genai import errors

    from app.server import classify_provider_error

    bot, fake = make(monkeypatch)
    calls = []

    def exhausted(model, contents, config):
        calls.append(model)
        raise errors.ClientError(429, {"error": {"code": 429, "message": "Quota exceeded. Please retry in 17h39m50s.",
                                                 "status": "RESOURCE_EXHAUSTED"}})

    fake.generate_content = exhausted
    with pytest.raises(errors.ClientError):
        bot.ask("first")
    assert len(calls) == len(llm.model_chain())
    second, _ = make(monkeypatch)
    with pytest.raises(llm.ModelsUnavailable) as caught:
        second.ask("second")
    assert len(calls) == len(llm.model_chain()), "no new Gemini call while every model cools down"
    assert classify_provider_error(caught.value) == "AI_QUOTA_EXCEEDED"


def test_retry_delay_is_read_from_the_quota_error():
    from google.genai import errors

    err = errors.ClientError(429, {"error": {"code": 429, "message": "x", "status": "RESOURCE_EXHAUSTED",
                                             "details": [{"retryDelay": "63590s"}]}})
    assert llm._retry_after_seconds(err) == 63590
    err = errors.ClientError(429, {"error": {"code": 429, "message": "Please retry in 1h2m3s.", "status": "X"}})
    assert llm._retry_after_seconds(err) == 3723


def test_next_question_starts_on_the_model_that_answered(monkeypatch):
    from google.genai import errors

    monkeypatch.setattr(llm.config, "GEMINI_MODEL", "busy-model")
    monkeypatch.setattr(llm.config, "GEMINI_FALLBACK_MODELS", ["spare-model"])
    tried = []
    bot, fake = make(monkeypatch)
    real = fake.generate_content

    def generate(model, contents, config):
        tried.append(model)
        if model == "busy-model":
            raise errors.ServerError(503, {"error": {"code": 503, "message": "high demand", "status": "UNAVAILABLE"}})
        return real(model, contents, config)

    fake.generate_content = generate
    bot.ask("first")
    tried.clear()
    second, fake2 = make(monkeypatch)
    fake2.generate_content = generate
    fake.calls = 0
    second.ask("second")
    assert tried[0] == "spare-model", "a new request does not start on the model that just failed"


def test_thinking_rejection_is_remembered_per_model(monkeypatch):
    from google.genai import errors

    seen = []

    def rejecting(real):
        def generate(model, contents, config):
            seen.append(config.thinking_config)
            if config.thinking_config is not None:
                raise errors.ClientError(400, {"error": {"code": 400, "message": "thinking_level is not supported",
                                                         "status": "INVALID_ARGUMENT"}})
            return real(model, contents, config)
        return generate

    bot, fake = make(monkeypatch)
    fake.generate_content = rejecting(fake.generate_content)
    bot.ask("first")
    seen.clear()
    second, fake2 = make(monkeypatch)
    fake2.generate_content = rejecting(fake2.generate_content)
    second.ask("second")
    assert seen and all(c is None for c in seen), "the rejected setting is not sent again"
