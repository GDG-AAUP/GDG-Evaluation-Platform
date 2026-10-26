# What the chatbot needs from other teams

## Backend 
Proposed read-only endpoints (all behind the same Clerk Bearer token and the same `loadProjectUser` checks). Names/shape are a PROPOSAL.
1. `GET /api/points/me?month=&year=&from=&to=&limit=`: add filters; include `activityDescription` and `reversesEntryId`.
2. `GET /api/rankings?scope=team|campus&campusId=&teamId=&month=&year=`: dense rank, month only; say whether the month is archived.
3. `GET /api/rankings/me?scope=&month=&year=`: own rank, points, gap to first.
4. `GET /api/evaluations/me?month=&year=` and a manager-evaluation summary per campus/month (count + average).
5. `GET /api/teams/:id/points?month=&year=&activity=`: team entries (manager of the team / organizer).
6. `GET /api/points/awarded-by-me?month=&year=`, and a member-points endpoint scoped to the manager's team.
7. Manager name in the team response (Q34) if it is allowed to be public.
Questions: Is a dev instance + a test Clerk token available for the AI team? Do ranking reads use `monthly_rankings`?

## Frontend 
Where does the chatbot appear? Who forwards the Clerk Bearer token to the chatbot service (proposal: the frontend sends
`Authorization: Bearer <token>` with every chat message, and the chatbot service passes it to the backend unchanged)?

## AI supervisor
Public-data decisions (mapping doc, open decisions 1, 2, 4), approved free LLM provider/model, and confirm what
"one-shot prompt" should mean for the team (we use exactly one worked example inside the system prompt).
