# Question -> tool -> data status

REAL = endpoint exists today in `02-Backend/docs/api.md`. PLANNED = does not exist; shape is our proposal (mock only).

| Questions | Tool | Backend data | Notes |
|---|---|---|---|
| 1-4, 7, 8, 19 | get_my_points | REAL `GET /api/points/me` | Returns only the latest 50 entries, no filters: month/range filtering is done in our code and flagged when it may be incomplete |
| 9 | get_my_points | REAL (partial) | Needs `reversesEntryId` in the response to answer properly |
| 5 | get_member_points | PLANNED | Manager: own team only |
| 6 | get_points_i_awarded | PLANNED | Uses `performed_by_user_id` |
| 10, 11, 14, 16, 18, 44 | get_leaderboard | PLANNED | Dense ranking; archived months need the `monthly_rankings` snapshot |
| 12, 13, 15 | get_my_ranking | PLANNED | 15 = two calls (this month vs last month) |
| 17 | none | none | No team-totals endpoint and no decision that team totals are public |
| 20-24, 36, 37 | get_my_evaluations | PLANNED | Evaluation module is not built yet. `performance_evaluations` has no description column (Q22) |
| 25-28 | get_team_activity_summary | PLANNED | 28: activity categories are not stored (free-text `activity_name`) |
| 29, 32, 33 | get_team_members | REAL `GET /api/teams/:id/members` | Organizer or the team's Manager only: Members get 403 (so Q29 is denied for Members). Manager is not in the list |
| 30 | list_teams | REAL `GET /api/teams` | |
| 31 | get_my_profile | REAL `GET /api/auth/me` + teams | |
| 34 | list_teams | REAL (partial) | Only `managerId`, no manager name |
| 35, 38, 39, 40 | get_manager_evaluations | PLANNED | Q39 supports month only (no custom range) |
| 41, 43 | (backend denies) | - | Tested: Manager -> other team, Member -> other member |
| 42 | get_audit_logs | PLANNED | Organizer only |
| 45 | none | - | No write tools exist; the prompt also refuses |

## Open decisions (ask the owner)
1. Which rankings/aggregates are public (Q10, 11, 16, 17, 29, 34)? -> Maria
2. Is "current points" monthly or something else (Q1)? -> Maria
3. Archived months: `monthly_rankings` snapshot or recompute from `point_entries`? Closed-month corrections matter here -> Backend
4. Who may see manager evaluation results via the chatbot (Q35, 38, 40)? Does the chatbot expose audit logs (Q42)? -> Maria
5. Evaluations: where do activity descriptions live (Q22)? Monthly average still wanted? -> Shorouq / Mohammed
6. `effective_at` vs `created_at` for "which month does an entry belong to" -> Backend
