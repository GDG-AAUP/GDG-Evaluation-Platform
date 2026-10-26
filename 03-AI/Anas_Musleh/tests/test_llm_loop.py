from datetime import date
from types import SimpleNamespace
from google.genai import types
from app import llm
from app.mock_backend import MockBackend
from app.tools import ToolExecutor


class Model:
    

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
    fake = Model()
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
    assert "token" not in sp.lower()           


def test_round_limit(monkeypatch):
    bot, fake = make(monkeypatch)
    monkeypatch.setattr(llm.config, "MAX_TOOL_ROUNDS", 2)
    fake.generate_content = lambda model, contents, config: SimpleNamespace(
        function_calls=[SimpleNamespace(name="get_my_points", args={})],
        candidates=[SimpleNamespace(content=types.Content(role="model", parts=[types.Part(text="x")]))], text=None)
    turn = bot.ask("loop")
    assert len(turn.tool_calls) == 2 and "خطوات" in turn.answer
