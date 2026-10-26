"""Settings. Everything configurable lives in .env so no secret is ever in the code."""
import os
from datetime import date

from dotenv import load_dotenv

load_dotenv()

BACKEND_MODE = os.getenv("BACKEND_MODE", "mock").lower()   # "mock" | "real"
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3001")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
MAX_TOOL_ROUNDS = int(os.getenv("MAX_TOOL_ROUNDS", "6"))
LLM_RETRIES = int(os.getenv("LLM_RETRIES", "4"))          # tries per model call on 429/503


def today() -> date:
    """The model has no clock, so WE give it today's date (needed for 'this month')."""
    pinned = os.getenv("MOCK_TODAY")
    if pinned:
        return date.fromisoformat(pinned)
    if BACKEND_MODE == "mock":
        return date(2026, 10, 23)      # fixed so the mock data and the tests stay consistent
    return date.today()
