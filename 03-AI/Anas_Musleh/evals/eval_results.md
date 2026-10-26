# Evaluation results (what was actually verified)

Setup: mock backend (fake data), Gemini model gemini-3.1-flash-lite, run on 2026-10-23.
Cases: the 45 scope questions + 2 extra access cases (42b: manager asks for audit logs, 45b: organizer asks for a write), each in 2 phrasings.

## What the automatic check does and does not prove
- It checks that the expected **tools were called**, that forbidden tools **returned no data**, and that write requests **called no tool**.
- It does **not** read the answer text. Rows marked REVIEW were read by a human; PASS rows were **not** read.

## Run 1 (all cases, 2 phrasings)
- No ERROR rows. Every case called the expected tools except **Q36 (both phrasings) and Q37.1**: a manager asking about their *own*
  evaluation was routed to the organizer-only tool and got a denial.
- The full report file of this run was overwritten by later runs (reports are now saved with a timestamp). The result above comes from the
  console output.

## Fixes made after Run 1
1. Tool descriptions + prompt rule: own evaluation (even for a manager) -> `get_my_evaluations`. A denied manager also gets a hint to use it.
2. Ties: the leaderboard tool now flags ties at rank 1 and `limit` never cuts a tie in half (Q10 first answered with one winner).
3. Evaluations: the result states that no activity-description field exists (Q22 first labeled the activity *name* as a description).

## After the fixes
- Q36.1: PASS. Q10 and Q22: answers read and correct (both tied members named; description reported as not available, name and comment given).
- Q37.1: **not confirmed** (Google returned 503 during the re-run). .

## Manual review of 12 answers (Q1, 10, 17, 22, 29, 34, 41, 42b, 43, 44, 45, 45b)
Acceptable: Q1 (states the month), Q17 (says team totals are not available), Q29 and Q34 (polite denial, no invented manager name),
Q41, Q42b, Q43 (denied without hinting at data), Q44 (no data for that month), Q45 and Q45b (refused, nothing claimed as changed).
Q10 and Q22 were wrong at first and fixed (above). Note: Q34's denial says "no permission" while the real reason is that the manager name is
not exposed to members; wording to refine once the backend decision is made.

## Not verified
- Anything against the **real backend** or a real Clerk token. Only the mock was used; the planned endpoints do not exist yet.
- The text of PASS answers, and answers in the second phrasing.
- Open decisions in `question_tool_mapping.md` (what is public, evaluation rules, archived months).
