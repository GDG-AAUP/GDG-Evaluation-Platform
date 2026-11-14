"""A Manager's common questions are answered instantly, without any Gemini call (and so even when every
model is out of quota); anything more specific still goes to the model."""
import time
from datetime import date
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app import config, quick, server
from app.mock_backend import MockBackend
from app.tools import ToolExecutor

TODAY = date(2026, 10, 23)


def executor(token="mock-sara"):          # Sara: manager of team 1 (Technical, Jenin)
    return ToolExecutor(MockBackend(), token, TODAY)


def test_manager_how_to_add_points_is_instant_and_read_only():
    started = time.perf_counter()
    answer = quick.quick_answer("كيف أضيف نقاطًا لعضو؟", executor())
    assert time.perf_counter() - started < 0.5
    assert "إضافة نقاط" in answer and "-100" in answer and "فريقك" in answer
    assert "للقراءة فقط" in answer


def test_how_is_the_ranking_calculated():
    answer = quick.quick_answer("كيف يُحسب الترتيب؟", executor())
    assert "شهري" in answer and "(1، 1، 2)" in answer
    assert "جنين ورام الله" in answer and "مدير" in answer


def test_manager_team_points_this_month_uses_live_data():
    ex = executor()
    answer = quick.quick_answer("كم نقاط فريقي هذا الشهر؟", ex)
    board = ex.client.leaderboard(ex.token, "team", 1, 1, 10, 2026, None)
    assert f"{board['totalPoints']} نقطة" in answer
    assert "Technical" in answer and "تشرين الأول 2026" in answer


def test_member_how_to_add_points_explains_the_permission():
    answer = quick.quick_answer("كيف اضيف نقاط؟", executor("mock-ahmad"))
    assert "مدير فريقك أو المنظّم" in answer


def test_my_points_this_month():
    ex = executor("mock-ahmad")
    answer = quick.quick_answer("كم نقطة عندي هذا الشهر؟", ex)
    total = ex.client.my_points_summary(ex.token, 10, 2026)["totalPoints"]
    assert answer.startswith(f"لديك {total} نقطة")


def test_specific_questions_still_go_to_the_model():
    ex = executor()
    for question in ["كم نقاط فريقي الشهر الماضي؟", "كم نقاط فريقي في 2025؟", "كم نقاط أحمد هذا الشهر؟",
                     "قارن نقاط فريقي مع فريق التسويق", "من الأول في حرم جنين؟"]:
        assert quick.quick_answer(question, ex) is None, question


def test_organizer_team_question_goes_to_the_model():
    assert quick.quick_answer("كم نقاط فريقي هذا الشهر؟", executor("mock-admin")) is None


def test_chat_endpoint_answers_a_manager_without_gemini_even_when_out_of_quota(monkeypatch):
    monkeypatch.setattr(config, "CHATBOT_INTERNAL_KEY", "k")
    monkeypatch.setattr(config, "BACKEND_MODE", "real")
    monkeypatch.setattr(config, "GEMINI_API_KEY", "g")
    monkeypatch.setattr(config, "today", lambda: TODAY)
    monkeypatch.setattr(server, "get_client", lambda: MockBackend())

    def no_gemini(executor):
        raise AssertionError("the model must not be called for these questions")

    monkeypatch.setattr(server, "Assistant", no_gemini)
    client = TestClient(server.app)
    headers = {"Authorization": "Bearer mock-sara", "X-Internal-Key": "k"}
    for question in ["كيف أضيف نقاطًا لعضو؟", "كم نقاط فريقي هذا الشهر؟", "كيف يُحسب الترتيب؟"]:
        started = time.perf_counter()
        res = client.post("/chat", json={"question": question}, headers=headers)
        assert res.status_code == 200, (question, res.text)
        assert res.json()["answer"]
        assert time.perf_counter() - started < 1.0


def test_other_questions_still_reach_the_model(monkeypatch):
    monkeypatch.setattr(config, "CHATBOT_INTERNAL_KEY", "k")
    monkeypatch.setattr(config, "BACKEND_MODE", "real")
    monkeypatch.setattr(config, "GEMINI_API_KEY", "g")
    monkeypatch.setattr(config, "today", lambda: TODAY)
    monkeypatch.setattr(server, "get_client", lambda: MockBackend())
    monkeypatch.setattr(server, "Assistant", lambda ex: SimpleNamespace(ask=lambda q: SimpleNamespace(answer="model")))
    res = TestClient(server.app).post("/chat", json={"question": "من الأول في حرم جنين؟"},
                                      headers={"Authorization": "Bearer mock-sara", "X-Internal-Key": "k"})
    assert res.json() == {"answer": "model"}
