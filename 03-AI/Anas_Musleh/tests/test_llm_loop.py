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
    turn = bot.ask("new question")
    assert turn.answer.startswith("حصلت")
    assert [c.role for c in bot.history] == ["user", "model", "user", "model"]
    assert bot.history[0].parts[0].text.startswith("new question")     # the old question is gone (an English question also carries the language note)


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
