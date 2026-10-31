# GDG Evaluation Platform - AI Chatbot (Phase 1)

Read-only assistant that answers questions about points, monthly rankings, evaluations, teams and members.
It never touches the database: it asks **tools**, the tools call the **backend**, and the backend decides what the
logged-in user may see (Bearer token from Clerk).

```
User question -> Gemini -> asks for a tool -> our code runs it (with the user's token) -> backend checks permission -> data
                       <- Gemini writes the answer from the tool result <-
```

## Status 
| Part | State |
|---|---|
| Tools layer, system prompt (one-shot), Gemini loop, terminal chat | Built |
| Mock backend (fake data + Member/Manager/Organizer permission rules) | Built, used by default |
| Real backend client | Built for the existing endpoints plus rankings, audit logs and manager-evaluation averages (Phase 2); `member_points`, `points_awarded_by_me`, `my_evaluations`, `team_activity_summary` still return `NOT_IMPLEMENTED` |
| Tests without a key (permissions, dense ranking, tool safety, loop logic) | 104 passing (`python -m pytest -q`; 43 + 61 Phase 2: real-backend contract, answer checks, suite integrity, fixes). Phase 2 fixes to prompts.py, tools.py and llm.py are listed in docs/FAILURE_LOG.md |
| Question bank (45 questions x 2 phrasings) + eval runner | Run against Gemini on the mock backend. Summary and limits: [docs/eval_results.md](docs/eval_results.md). Phase 2: 23 extra cases + 46 extra phrasings, see [docs/EVALUATION_TEST_CASES.md](docs/EVALUATION_TEST_CASES.md) and [docs/FAILURE_LOG.md](docs/FAILURE_LOG.md) |
| Tested against the real Node backend + Clerk token | **Not done.** Offline contract tests exist; steps in [docs/RUN_ON_REAL_BACKEND.md](docs/RUN_ON_REAL_BACKEND.md) |


## Structure
```
app/config.py          settings from .env (+ "today", because the model has no clock)
app/backend_client.py  the only door to data: RealBackendClient / MockBackend share one interface
app/mock_backend.py    fake data + permission rules (PLANNED endpoints are OUR proposal)
app/tools.py           13 read-only tools + safety rules (no write tools, no user_id params)
app/prompts.py         system prompt with rules and one-shot example
app/llm.py             Gemini function-calling loop
app/chat.py            terminal chat
evals/                 the 45-question bank + runner
tests/                 tests that run without a key
```

## Design rules 
1. **Read-only.** No tool writes anything. Do not add one.
2. **Identity = token.** The model never sees the token and never receives a user id for "my ..." questions.
3. **Permissions live in the backend**, not in the prompt. The prompt is only the last line of defense.
4. **No guessing.** Errors and empty results go back to the model as data so it explains them.
5. **Mock data is fake and clearly marked.** Never present mock output as real.

## Assumptions we made (all pending a team decision - see mapping doc)
- Any logged-in user may see team/campus leaderboards (names + monthly points).
- "My current points" = this month's points.
- Manager evaluations of a campus are Organizer-only through the chatbot.
- Months are read from `effective_at` of point entries.
