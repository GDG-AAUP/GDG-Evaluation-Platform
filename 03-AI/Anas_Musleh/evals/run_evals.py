"""
Run the question bank against the REAL model (needs GEMINI_API_KEY) using the mock backend.

  python -m evals.run_evals                 # all cases, both phrasings
  python -m evals.run_evals --ids 2,10,45   # selected cases
  python -m evals.run_evals --variants 1    # only the original phrasing (fewer API calls)

Automatic checks: expected tools were called, forbidden tools returned no data, read-only refusals
called no tool (FAIL), and the answer TEXT is scanned for invented numbers, claimed writes and leaked internals
(WARN, see evals/answer_checks.py). Answers that need a human eye are marked REVIEW. Report: evals/report.md

  python -m evals.run_evals --suite all --more      # core + Phase 2 cases + extra phrasings
"""
import argparse
import json
import os
import time
from datetime import datetime
from pathlib import Path

from app import config
from app.backend_client import get_client
from app.llm import Assistant
from app.tools import ToolExecutor
from evals.answer_checks import check_answer
from evals.cases import CASES
from evals.cases_extra import CASES_EXTRA, MORE_VARIANTS


ROLE_OF = {"admin": "ORGANIZER", "sara": "MANAGER"}          # every other persona = MEMBER


def token_for(persona: str) -> str:
    """mock mode: fake token. real mode: a Clerk session token from GDG_TOKEN_ORGANIZER / _MANAGER / _MEMBER."""
    if config.BACKEND_MODE != "real":
        return f"mock-{persona}"
    var = f"GDG_TOKEN_{ROLE_OF.get(persona, 'MEMBER')}"
    tok = os.getenv(var, "")
    if not tok:
        raise RuntimeError(f"real mode: set {var} (Clerk token of a {ROLE_OF.get(persona, 'MEMBER').lower()} test account)")
    return tok


def check(case: dict, turn) -> list[str]:
    problems = []
    called = [t["name"] for t in turn.tool_calls]
    for need in case["tools"]:
        if need not in called:
            problems.append(f"missing tool: {need}")
    for t in turn.tool_calls:
        if t["name"] in case["forbid_success"] and "error" not in t["result"]:
            problems.append(f"LEAK: {t['name']} returned data")
    if case["no_tools"] and called:
        problems.append(f"read-only violated: called {called}")
    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", default="")
    ap.add_argument("--variants", type=int, default=2, choices=[1, 2])
    ap.add_argument("--delay", type=float, default=8.0, help="seconds between questions (free tier rate limits)")
    ap.add_argument("--from-id", default="", help="resume: start from this case id (e.g. 36 or X05)")
    ap.add_argument("--suite", choices=["core", "extra", "all"], default="core",
                    help="core = the 45 scope questions, extra = Phase 2 cases (injection, off-topic, ambiguity...), all = both")
    ap.add_argument("--all-answers", action="store_true", help="print the answer of PASS rows too (default: only REVIEW/WARN/FAIL/ERROR)")
    ap.add_argument("--more", action="store_true", help="also run the extra phrasings in MORE_VARIANTS")
    args = ap.parse_args()
    wanted = {x.strip() for x in args.ids.split(",") if x.strip()}
    pool = {"core": CASES, "extra": CASES_EXTRA, "all": CASES + CASES_EXTRA}[args.suite]
    cases = [c for c in pool if (not wanted or str(c["id"]) in wanted)]
    if args.from_id:
        ids = [str(c["id"]) for c in cases]
        cases = cases[ids.index(args.from_id):] if args.from_id in ids else cases

    rows, ok, quota_streak, stopped = [], 0, 0, None
    for c in cases:
        phrasings = [c["q"], c["alt"]][: args.variants]
        if args.more:
            phrasings += MORE_VARIANTS.get(c["id"], [])
        for v, text in enumerate(phrasings, 1):
            try:
                ex = ToolExecutor(get_client(), token_for(c["persona"]), config.today())
                turn = Assistant(ex).ask(text)
                problems = check(c, turn)
                warns = check_answer(c, text, turn, config.today())
                status = ("FAIL" if problems else "WARN" if warns else ("REVIEW" if c["review"] else "PASS"))
                problems = problems + warns
                tools = ", ".join(t["name"] for t in turn.tool_calls) or "-"
                answer = turn.answer
            except Exception as e:                                # e.g. rate limit / network
                status, problems, tools, answer = "ERROR", [str(e)[:200]], "-", ""
            quota_streak = quota_streak + 1 if status == "ERROR" and ("429" in problems[0] or "RESOURCE_EXHAUSTED" in problems[0]) else 0
            ok += status in ("PASS", "REVIEW", "WARN")
            rows.append((c, v, text, status, tools, problems, answer))
            print(f"Q{c['id']}.{v} {status:6} tools=[{tools}] {'; '.join(problems)}")
            if quota_streak >= 3:
                stopped = c["id"]
                break
            time.sleep(args.delay)
        if stopped:
            print(f"\nSTOPPED at Q{stopped}: free quota is exhausted. Wait (minutes or until tomorrow), "
                  f"then continue with:  python -m evals.run_evals --suite {args.suite} --from-id {stopped}")
            break

    lines = ["# Eval report", "", f"Passed automatic checks: {ok}/{len(rows)}  (REVIEW = a human must read the answer, WARN = text check fired)", "",
             "| Q | v | status | tools called | problems |", "|---|---|---|---|---|"]
    for c, v, text, status, tools, problems, _ in rows:
        lines.append(f"| {c['id']} | {v} | {status} | {tools} | {'; '.join(problems)} |")
    lines += ["", "## Answers to read", ""]
    for c, v, text, status, tools, problems, answer in rows:
        if args.all_answers or status in ("REVIEW", "FAIL", "ERROR", "WARN"):
            lines += [f"### Q{c['id']}.{v} ({c['persona']}) - {status}", f"**Asked:** {text}", f"**Answer:** {answer}",
                      f"**Check:** {c['review'] or ''}", ""]
    text = "\n".join(lines)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    Path(f"evals/report_{stamp}.md").write_text(text, encoding="utf-8")   # never overwritten
    Path("evals/report.md").write_text(text, encoding="utf-8")            # always the latest run
    print(f"\nReport written to evals/report_{stamp}.md (and evals/report.md)")


if __name__ == "__main__":
    main()
