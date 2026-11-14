"""Private HTTP wrapper around the assistant. Only the Node backend may call it.

Run: uvicorn app.server:app --host 127.0.0.1 --port 8000
"""
from __future__ import annotations

import hmac
import logging
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException
from google import genai
from google.genai import errors as genai_errors
from pydantic import BaseModel, Field

from . import config
from .backend_client import get_client
from .errors import BackendError
from .llm import Assistant, ModelsUnavailable, model_chain
from .quick import quick_answer
from .tools import ToolExecutor

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("gdg.chatbot")

# Result of the startup check, reported by /health. None until a check has run.
ai_status: dict = {"ok": None, "code": None, "detail": None, "model": None}


def classify_provider_error(error: Exception) -> str:
    """Maps a Gemini failure to a stable code the backend and frontend can act on."""
    if isinstance(error, ModelsUnavailable):
        return "AI_QUOTA_EXCEEDED" if error.quota else "AI_UNAVAILABLE"
    if isinstance(error, genai_errors.APIError):
        message = str(error.message or "").lower()
        if error.code in (401, 403) or "api key" in message:
            return "AI_KEY_INVALID"
        if error.code == 404:
            return "AI_MODEL_UNAVAILABLE"
        if error.code == 429:
            return "AI_QUOTA_EXCEEDED"
        if error.code == 400:
            return "AI_REQUEST_REJECTED"
    return "AI_UNAVAILABLE"


def check_ai_provider() -> None:
    """One tiny real request per model until one answers, so a bad key or unavailable models are
    reported at startup instead of on a user's first question. Never fatal."""
    if not config.GEMINI_API_KEY:
        ai_status.update(ok=False, code="AI_KEY_MISSING", detail="GEMINI_API_KEY is not set", model=None)
        logger.error("Gemini check FAILED: GEMINI_API_KEY is not set")
        return
    client = genai.Client(api_key=config.GEMINI_API_KEY)
    for model in model_chain():
        try:
            client.models.generate_content(model=model, contents="Reply with: ok",
                                           config={"http_options": {"timeout": config.GEMINI_TIMEOUT_MS}})
            ai_status.update(ok=True, code=None, detail=None, model=model)
            logger.info("Gemini check passed with model %s", model)
            return
        except Exception as error:  # noqa: BLE001 - every failure is reported, none is fatal
            code = classify_provider_error(error)
            ai_status.update(ok=False, code=code, detail=f"{type(error).__name__}: {str(error)[:300]}", model=None)
            logger.warning("Gemini check: model %s unavailable (%s)", model, ai_status["detail"])
            if code in ("AI_KEY_INVALID", "AI_KEY_MISSING"):
                break
    logger.error("Gemini check FAILED for every model %s: %s", model_chain(), ai_status["code"])


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if not config.CHATBOT_INTERNAL_KEY:
        logger.error("CHATBOT_INTERNAL_KEY is not set: every chat request will be refused")
    if config.BACKEND_MODE != "real":
        logger.error("BACKEND_MODE is '%s': the HTTP service only answers with BACKEND_MODE=real", config.BACKEND_MODE)
    check_ai_provider()
    yield


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)


def _unavailable(code: str) -> HTTPException:
    return HTTPException(status_code=503, detail={"code": code})


@app.get("/health")
def health():
    return {"status": "ok", "models": model_chain(),
            "ai": {"ok": ai_status["ok"], "code": ai_status["code"], "model": ai_status["model"]}}


# A plain def: FastAPI runs it in a worker thread, so slow Gemini calls do not block other requests.
@app.post("/chat")
def chat(body: ChatRequest, authorization: str = Header(default=""), x_internal_key: str = Header(default="")):
    if not config.CHATBOT_INTERNAL_KEY or config.BACKEND_MODE != "real" or not config.GEMINI_API_KEY:
        raise _unavailable("CHATBOT_NOT_CONFIGURED")      # never answer real users from mock data
    if not hmac.compare_digest(x_internal_key.strip().encode(), config.CHATBOT_INTERNAL_KEY.encode()):
        logger.warning("Refused /chat: X-Internal-Key does not match CHATBOT_INTERNAL_KEY")
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN"})
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail={"code": "UNAUTHENTICATED"})

    token = authorization[7:].strip()
    try:
        executor = ToolExecutor(get_client(), token, config.today())
        # How-to questions and "my / my team's points this month" need no AI call: instant, and they
        # keep working when every Gemini model is out of quota.
        quick = quick_answer(body.question, executor)
        if quick is not None:
            return {"answer": quick}
        assistant = Assistant(executor)
        return {"answer": assistant.ask(body.question).answer}
    except BackendError as error:
        if error.status == 401:
            raise HTTPException(status_code=401, detail={"code": "UNAUTHENTICATED"})
        logger.warning("Backend error during chat: %s (%s)", error.code, error.status)
        raise _unavailable("BACKEND_UNAVAILABLE")
    except Exception as error:                            # Gemini down, quota, retired model, network
        code = classify_provider_error(error)
        if isinstance(error, (ModelsUnavailable, TimeoutError)) or code in ("AI_QUOTA_EXCEEDED", "AI_UNAVAILABLE"):
            logger.warning("Chat failed: %s %s: %s", code, type(error).__name__, str(error)[:200])
        else:
            logger.error("Chat failed: %s %s: %s\n%s", code, type(error).__name__, str(error)[:500], traceback.format_exc())
        raise _unavailable(code)
