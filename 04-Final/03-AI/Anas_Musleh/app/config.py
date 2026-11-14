import os
from datetime import date, datetime
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

load_dotenv()

APP_TZ = ZoneInfo("Asia/Hebron")
CHATBOT_INTERNAL_KEY = (os.getenv("CHATBOT_INTERNAL_KEY") or "").strip()

BACKEND_MODE = os.getenv("BACKEND_MODE", "mock").lower()   # "mock" | "real"
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3001")
def _clean(value: str | None) -> str:
    """Strips whitespace, a byte-order mark and wrapping quotes that editors and shells add."""
    return (value or "").strip().lstrip("﻿").strip().strip('"').strip("'").strip()


GEMINI_API_KEY = _clean(os.getenv("GEMINI_API_KEY"))
# gemini-2.5-flash is no longer offered to new API keys; Google's current recommendation is 3.8.
GEMINI_MODEL = _clean(os.getenv("GEMINI_MODEL")) or "gemini-3.8-flash"
# Tried in order when the main model is overloaded, rate-limited or retired.
GEMINI_FALLBACK_MODELS = [m for m in (_clean(x) for x in os.getenv(
    "GEMINI_FALLBACK_MODELS", "gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite").split(",")) if m]
# Per-request limit: a stuck call fails fast and the next model is tried.
GEMINI_TIMEOUT_MS = int(os.getenv("GEMINI_TIMEOUT_MS", "12000"))
# Latency: "thinking" is the largest part of a Flash call. Factual lookups need almost none.
# minimal | low | medium | high, or empty to use the model's default.
GEMINI_THINKING_LEVEL = _clean(os.getenv("GEMINI_THINKING_LEVEL", "minimal")).upper()
# Answers are short; this caps a runaway reply without truncating normal answers or ranking lists.
GEMINI_MAX_OUTPUT_TOKENS = int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "1024"))
GEMINI_TEMPERATURE = float(os.getenv("GEMINI_TEMPERATURE", "0.2"))
MAX_TOOL_ROUNDS = int(os.getenv("MAX_TOOL_ROUNDS", "6"))
LLM_RETRIES = int(os.getenv("LLM_RETRIES", "1"))   # full passes over the model list (the fallbacks already retry)
# Whole-question budget: no new Gemini call starts after this, so the Node proxy (30 s) always gets
# a clear answer or a clear error instead of hanging.
CHAT_DEADLINE_S = float(os.getenv("CHAT_DEADLINE_S", "25"))


def today() -> date:
    pinned = os.getenv("MOCK_TODAY")
    if pinned:
        return date.fromisoformat(pinned)
    if BACKEND_MODE == "mock":
        return date(2026, 10, 23)      
    return datetime.now(APP_TZ).date()
