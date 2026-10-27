"""Terminal chat.   Examples:
     python -m app.chat --user ahmad        (mock mode, logged in as a Member)
     python -m app.chat --user sara         (mock mode, a Manager)
     python -m app.chat --user admin        (mock mode, an Organizer)
     BACKEND_MODE=real GDG_BEARER_TOKEN=... python -m app.chat   (real backend)
"""
import argparse
import os
import sys

from . import config
from .backend_client import get_client
from .errors import BackendError
from .llm import Assistant
from .tools import ToolExecutor


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", default="ahmad", help="mock persona: admin, sara, ahmad, lina, omar, rana, dana, yousef")
    ap.add_argument("--debug", action="store_true", help="show which tools the model called")
    args = ap.parse_args()

    if not config.GEMINI_API_KEY:
        print("GEMINI_API_KEY is missing. Copy .env.example to .env and add your key.")
        return 1
    token = os.getenv("GDG_BEARER_TOKEN", "") if config.BACKEND_MODE == "real" else f"mock-{args.user}"
    try:
        assistant = Assistant(ToolExecutor(get_client(), token, config.today()))
    except BackendError as e:
        print(f"Login failed: {e.message}")
        return 1

    print(f"[{config.BACKEND_MODE} mode] اكتب سؤالك (exit للخروج)")
    while True:
        try:
            q = input("\nأنت: ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if q.lower() in ("exit", "quit", "خروج"):
            break
        if not q:
            continue
        try:
            turn = assistant.ask(q)
        except Exception as e:                       # Gemini down / quota / network: keep chatting
            print(f"\n[خطأ] تعذّر الحصول على إجابة الآن ({type(e).__name__}). لم يُحفظ هذا السؤال، أعد المحاولة بعد قليل.")
            if args.debug:
                print(f"   {str(e)[:200]}")
            continue
        if args.debug:
            for t in turn.tool_calls:
                print(f"   [tool] {t['name']}({t['args']}) -> {str(t['result'])[:120]}")
        print(f"\nالمساعد: {turn.answer}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
