# GDG Evaluation Platform - AI Chatbot (Phase 1 prototype)

Read-only assistant that answers questions about points, monthly rankings, evaluations, teams and members.
It never touches the database: it asks **tools**, the tools call the **backend**, and the backend decides what the
logged-in user may see (Bearer token from Clerk).

```
User question -> Gemini -> asks for a tool -> our code runs it (with the user's token) -> backend checks permission -> data
                       <- Gemini writes the answer from the tool result <-
```

## Status (honest)
| Part | State |
|---|---|
| Tools layer, system prompt (one-shot), Gemini loop, terminal chat | Built |
| Mock backend (fake data + Member/Manager/Organizer permission rules) | Built, used by default |
| Real backend client | Built for the 5 endpoints that exist today; the rest return `NOT_IMPLEMENTED` |
| Tests without a key (permissions, dense ranking, tool safety, loop logic) | 43 passing (`python -m pytest -q`) |
| Question bank (45 questions x 2 phrasings) + eval runner | Run against Gemini on the mock backend. Summary and limits: [docs/eval_results.md](docs/eval_results.md) |
| Tested against the real Node backend + Clerk token | **Not done** |

Question -> tool -> data status: [docs/question_tool_mapping.md](docs/question_tool_mapping.md)
What we need from Backend/Frontend/Maria: [docs/backend_requests.md](docs/backend_requests.md)
Concepts explained step by step (Arabic): [docs/how_it_works.md](docs/how_it_works.md)

## Run it
```bash
cd <this folder>      # the folder that contains app/, evals/, tests/
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # then put your GEMINI_API_KEY in .env  (never commit .env)
python -m pytest -q                       # no key needed
python -m app.chat --user ahmad --debug   # Member.  Others: sara (Manager), admin (Organizer), lina, omar, rana, dana, yousef
python -m evals.run_evals --variants 1    # runs the 45 questions (needs the key; mind free-tier rate limits)
```
Real backend: set `BACKEND_MODE=real`, `BACKEND_URL=...` and `GDG_BEARER_TOKEN=<Clerk session token>`.

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

## Design rules (do not break these)
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
- The model name is set in `.env` (`GEMINI_MODEL`). Model names get retired (`gemini-2.5-flash` returned 404 for new keys), so copy a current one from Google AI Studio or from `client.models.list()`.

## Troubleshooting
| Problem | Fix |
|---|---|
| `404 NOT_FOUND ... model ... no longer available` | Google retired the model. Copy the new model name from the error message (or from AI Studio) into `GEMINI_MODEL` in `.env`. |
| `.env` is a *folder*, not a file | `rmdir .env`, then `copy .env.example .env` |
| `429` / quota | Free-tier rate limit: wait, or raise `--delay` in `evals.run_evals` |
| Arabic text looks reversed in `cmd` | Display issue only (not a bug). Use the VS Code terminal or Windows Terminal |
| `No module named pytest` | Activate the venv first, then `python -m pip install -r requirements.txt` |

## Before committing
Never commit `.env`, `.venv/`, `venv/` or `__pycache__/` (all in `.gitignore`). Run `git status` and make sure none of them is listed.
