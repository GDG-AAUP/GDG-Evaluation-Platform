"""
Run the question bank against the REAL model (needs GEMINI_API_KEY) using the mock backend.

  python -m evals.run_evals                 # all cases, both phrasings
  python -m evals.run_evals --ids 2,10,45   # selected cases
  python -m evals.run_evals --variants 1    # only the original phrasing (fewer API calls)

Automatic checks: expected tools were called, forbidden tools returned no data, read-only refusals
called no tool. Answers that need a human eye are marked REVIEW. Report: evals/report.md
"""
import argparse
import json
import time
from datetime import datetime
from pathlib import Path

from app import config
from app.backend_client import get_client
from app.llm import Assistant
from app.tools import ToolExecutor
from evals.cases import CASES


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
    ap.add_argument("--from-id", type=int, default=0, help="resume: start from this question number")
    args = ap.parse_args()
    wanted = {x.strip() for x in args.ids.split(",") if x.strip()}
    cases = [c for c in CASES if (not wanted or str(c["id"]) in wanted)
             and int(str(c["id"]).rstrip("b")) >= args.from_id]

    rows, ok, quota_streak, stopped = [], 0, 0, None
    for c in cases:
        for v, text in enumerate([c["q"], c["alt"]][: args.variants], 1):
            try:
                ex = ToolExecutor(get_client(), f"mock-{c['persona']}", config.today())
                turn = Assistant(ex).ask(text)
                problems = check(c, turn)
                status = "FAIL" if problems else ("REVIEW" if c["review"] else "PASS")
                tools = ", ".join(t["name"] for t in turn.tool_calls) or "-"
                answer = turn.answer
            except Exception as e:                                # e.g. rate limit / network
                status, problems, tools, answer = "ERROR", [str(e)[:200]], "-", ""
            quota_streak = quota_streak + 1 if status == "ERROR" and ("429" in problems[0] or "RESOURCE_EXHAUSTED" in problems[0]) else 0
            ok += status in ("PASS", "REVIEW")
            rows.append((c, v, text, status, tools, problems, answer))
            print(f"Q{c['id']}.{v} {status:6} tools=[{tools}] {'; '.join(problems)}")
            if quota_streak >= 3:
                stopped = c["id"]
                break
            time.sleep(args.delay)
        if stopped:
            print(f"\nSTOPPED at Q{stopped}: free quota is exhausted. Wait (minutes or until tomorrow), "
                  f"then continue with:  python -m evals.run_evals --from-id {int(str(stopped).rstrip('b'))}")
            break

    lines = ["# Eval report", "", f"Passed automatic checks: {ok}/{len(rows)}  (REVIEW = a human must read the answer)", "",
             "| Q | v | status | tools called | problems |", "|---|---|---|---|---|"]
    for c, v, text, status, tools, problems, _ in rows:
        lines.append(f"| {c['id']} | {v} | {status} | {tools} | {'; '.join(problems)} |")
    lines += ["", "## Answers to read", ""]
    for c, v, text, status, tools, problems, answer in rows:
        if status in ("REVIEW", "FAIL", "ERROR"):
            lines += [f"### Q{c['id']}.{v} ({c['persona']}) - {status}", f"**Asked:** {text}", f"**Answer:** {answer}",
                      f"**Check:** {c['review'] or ''}", ""]
    text = "\n".join(lines)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    Path(f"evals/report_{stamp}.md").write_text(text, encoding="utf-8")   # never overwritten
    Path("evals/report.md").write_text(text, encoding="utf-8")            # always the latest run
    print(f"\nReport written to evals/report_{stamp}.md (and evals/report.md)")


if __name__ == "__main__":
    main()
