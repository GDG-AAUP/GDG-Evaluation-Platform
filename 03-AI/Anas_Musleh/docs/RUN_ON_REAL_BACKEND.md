# Running the chatbot and the evals against the real backend

Everything below needs things the AI folder does not contain: a running `02-Backend`, its PostgreSQL database with test data, and a Clerk dev instance. Until then only mock mode and the offline contract tests (`tests/test_real_backend_contract.py`) can run.

## 1. Setup
```
cd 02-Backend && npm install && npm run build && npm start      # http://localhost:3001  (check /api/ready)
cd 03-AI/Anas_Musleh
cp .env.example .env     # BACKEND_MODE=real, BACKEND_URL=http://localhost:3001, GEMINI_API_KEY=...
```
Test accounts needed in the database: one **organizer**, one **manager** with a team, one **member** in that manager's team, with some point entries in the current and previous month, and at least one published (archived) month.

## 2. Tokens
```
export GDG_TOKEN_ORGANIZER=...   GDG_TOKEN_MANAGER=...   GDG_TOKEN_MEMBER=...     # Clerk session tokens
```
Clerk session tokens expire quickly (about a minute by default - confirm with the backend team). For a long run, create a JWT template with a longer lifetime in the Clerk dev instance, or re-export the tokens and resume with `--from-id`.

## 3. Smoke test, then the evals
```
BACKEND_MODE=real GDG_BEARER_TOKEN=$GDG_TOKEN_MEMBER python -m app.chat --debug     # ask: "كم نقطة حصلت هذا الشهر؟"
python -m evals.run_evals --suite core --variants 1 --delay 8
python -m evals.run_evals --suite all --more
```
In real mode the personas map to roles: `admin` = organizer, `sara` = manager, everything else = member.

## 4. Adapting the questions to the real data
Cases that name people or teams (Q5, Q26, Q39, Q41, Q43, X11, X12, X18) use the mock names (أحمد، لينا، رنا، سارة...). Replace them with names from the seeded database before judging, otherwise a "not found" answer is correct but proves nothing. Do this in `evals/cases.py` / `cases_extra.py` and regenerate the table with `python -m evals.export_cases_md`.

## 5. What a correct real-mode result looks like
- Cases whose tools are marked `NO` in `docs/EVALUATION_TEST_CASES.md`: the answer says the information is not available in the assistant yet. An invented number is a FAIL even if the tool check passes.
- Ranking answers: compare the numbers with `GET /api/rankings?scope=team&teamId=..&year=..&month=..` and with the database.
- Role checks: the member token must never receive data from `/api/audit`, `/api/users` or `/api/evaluations/*` (the backend returns 403 and the chatbot must say it is not allowed).
- Record every deviation in `docs/FAILURE_LOG.md`.
