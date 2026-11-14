from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import config, server
from app.errors import BackendError

KEY = "test-internal-key"
HEADERS = {"Authorization": "Bearer user-token", "X-Internal-Key": KEY}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(config, "CHATBOT_INTERNAL_KEY", KEY)
    monkeypatch.setattr(config, "BACKEND_MODE", "real")
    monkeypatch.setattr(config, "GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr(server, "get_client", lambda: object())
    monkeypatch.setattr(server, "ToolExecutor", lambda c, token, today: SimpleNamespace(token=token))
    monkeypatch.setattr(server, "quick_answer", lambda question, executor: None)   # tested in test_quick.py
    return TestClient(server.app)


def use_assistant(monkeypatch, ask):
    monkeypatch.setattr(server, "Assistant", lambda executor: SimpleNamespace(ask=lambda q: ask(executor, q)))


def post(client, headers=HEADERS):
    return client.post("/chat", json={"question": "كم نقاطي؟"}, headers=headers)


def test_answers_using_the_callers_token(client, monkeypatch):
    use_assistant(monkeypatch, lambda ex, q: SimpleNamespace(answer=f"{ex.token}:{q}"))
    res = post(client)
    assert res.status_code == 200
    assert res.json() == {"answer": "user-token:كم نقاطي؟"}


def test_rejects_callers_without_the_internal_key(client):
    assert post(client, {"Authorization": "Bearer x", "X-Internal-Key": "wrong"}).status_code == 403


def test_requires_a_user_token(client):
    assert post(client, {"X-Internal-Key": KEY}).status_code == 401


def test_refuses_to_serve_mock_data(client, monkeypatch):
    monkeypatch.setattr(config, "BACKEND_MODE", "mock")
    res = post(client)
    assert res.status_code == 503
    assert res.json()["detail"]["code"] == "CHATBOT_NOT_CONFIGURED"


def test_ai_provider_failure_is_a_clean_503(client, monkeypatch):
    def fail(ex, q):
        raise RuntimeError("secret provider detail")
    use_assistant(monkeypatch, fail)
    res = post(client)
    assert res.status_code == 503
    assert "secret" not in res.text


def test_provider_errors_get_specific_codes(client, monkeypatch):
    from google.genai import errors

    for status, expected in [(404, "AI_MODEL_UNAVAILABLE"), (429, "AI_QUOTA_EXCEEDED"), (403, "AI_KEY_INVALID")]:
        def fail(ex, q, status=status):
            raise errors.ClientError(status, {"error": {"code": status, "message": "x", "status": "X"}})
        use_assistant(monkeypatch, fail)
        res = post(client)
        assert res.status_code == 503
        assert res.json()["detail"]["code"] == expected


def test_startup_check_reports_a_retired_model(monkeypatch):
    from google.genai import errors

    class FakeModels:
        def generate_content(self, **_):
            raise errors.ClientError(404, {"error": {"code": 404, "message": "no longer available", "status": "NOT_FOUND"}})

    monkeypatch.setattr(config, "GEMINI_API_KEY", "k")
    monkeypatch.setattr(config, "GEMINI_FALLBACK_MODELS", ["backup-model"])
    monkeypatch.setattr(server.genai, "Client", lambda api_key: SimpleNamespace(models=FakeModels()))
    server.check_ai_provider()
    assert server.ai_status["ok"] is False
    assert server.ai_status["code"] == "AI_MODEL_UNAVAILABLE"
    assert TestClient(server.app).get("/health").json()["ai"]["code"] == "AI_MODEL_UNAVAILABLE"


def test_config_strips_pasted_whitespace_and_quotes():
    assert config._clean('﻿ "AIza-key" \n') == "AIza-key"


def test_expired_user_token_stays_401(client, monkeypatch):
    def fail(ex, q):
        raise BackendError("UNAUTHENTICATED", "Authentication is required", 401)
    use_assistant(monkeypatch, fail)
    assert post(client).status_code == 401
