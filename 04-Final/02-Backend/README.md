# GDG Evaluation Backend

Express API with PostgreSQL and Clerk authentication. This folder contains backend code only. The frontend is `01-Frontend` and the assistant is `03-AI`.

## Setup

1. Install Node.js 24 and PostgreSQL, then run `npm ci`.
2. Create `.env` from `.env.example` and keep it private. The required values are:
   - **Database:** the five `DB_*` variables, or one `DATABASE_URL` used when `DB_HOST` is unset. Hosted databases also need `PGSSLMODE=require`.
   - **Clerk:** `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`, from the same Clerk instance.
   - **Browser access:** `CORS_ORIGINS`.
   - **Super Admins:** `SUPER_ADMIN_CLERK_IDS`.
   - **Chatbot:** `CHATBOT_URL` and `CHATBOT_INTERNAL_KEY`.
   - **Optional:** `SMTP_*` and `FROM_EMAIL` for approval and rejection emails, and `APP_LOGIN_URL` for the sign-in link in those emails.
3. For a new, empty database:
   ```bash
   psql -d gdg_evaluation -v ON_ERROR_STOP=1 -f db/setup-new-database.sql
   ```
   This runs the base schema and migrations 002–012 in order. An existing database needs only its unapplied migrations, after a backup; see [db/README.md](db/README.md).
4. Bootstrap the first Super Admin. Insert an active Organizer row (by email, or with its Clerk user ID) and list its Clerk user ID in `SUPER_ADMIN_CLERK_IDS`. Everyone else joins through the registration request flow.
5. Run `npm run dev` for development, or `npm run build` then `node src/server.js` in production.

`GET /api/health` checks the server and `GET /api/ready` checks the database. Every other endpoint, except the public ranking options and summary, needs a Clerk Bearer token and the right project role. See the [API reference](docs/api.md).

## Structure

- `src/routes`: request handling and response status codes.
- `src/middleware`: identity (Clerk → project account, Super Admin flag), role and team access checks.
- `src/validators`: accepted fields, types and ID validation.
- `src/services`: registration (emails), account governance, invitations, identity linking.
- `src/repositories`: parameterized PostgreSQL queries, transactions, audit and history updates.
- `src/phase2`: points, rankings, archive, evaluations, ratings, activities, governance, assistant data (TypeScript compiled to `dist/`).
- `db`: base schema and incremental migrations 002–012.
- `tests`: validation, route and database workflow tests.

## Checks

`npm test` builds and runs every test. The database workflow tests run only when `DB_*` variables point to a PostgreSQL server where the user may create schemas. Each test works in its own throwaway schema or in TEMP tables, replaces Clerk and SMTP with fakes, and never sends real email or touches real accounts. `npm run test:db` loads `.env` for those variables.

## Account management (summary)

- **New accounts:** they come only from approved registration requests. `POST /api/users` answers `405 MANUAL_CREATION_DISABLED`.
- **Who manages whom:**
  - A Super Admin manages every account except Super Admin accounts.
  - A regular Organizer manages Members and Managers of its own campus. It can read everyone, and the same campus scope applies to team changes.
- **Restore & Reassign:** returns an archived account active, with an explicitly confirmed role, campus and team. Manager seats are never reclaimed silently.
- **History and protections:** every change keeps assignment history and audit records. Manager-replacement, last-Organizer and self-lockout protections apply everywhere.

See [registration and the API](docs/api.md), [editing](docs/user-editing.md), [deletion and restoration](docs/user-deletion.md), [invitations](docs/account-invitations.md) and [final database integration](docs/final-database.md).
