# GDG Evaluation Backend

Express API with PostgreSQL and Clerk authentication. This repository contains backend code only.

## Setup

1. Install Node.js 24 and PostgreSQL. Run `npm ci`.
2. Create `.env` using `.env.example` and fill in database credentials and the Clerk application's keys. Keep `.env` private.
3. For a new empty database, run `db/GDG_evaluation_database.final.postgresql.sql`, followed by migrations `002_user_invitations.sql`, `003_user_soft_delete.sql`, and `004_final_backend_schema.sql` in order. Existing initialized databases need only unapplied migrations; do not rerun the base schema or migration 002.
4. Configure `CLERK_INVITATION_REDIRECT_URL` with the frontend team's invitation acceptance URL. Use HTTPS in production. Invitations cannot be sent without it; the backend does not host that page.
5. Provision the initial active Organizer account in the database with its Clerk user ID. Subsequent access uses verified sessions and database roles.
6. Run `npm run dev` for development or `npm start` for normal startup.

`GET /api/health` checks the server; `GET /api/ready` checks database connectivity. Other endpoints require a Clerk Bearer token and the applicable project role. See [API reference](docs/api.md).

## Structure

- `src/routes`: request handling and response status codes.
- `src/middleware`: identity, project role and team access checks.
- `src/validators`: accepted fields, types and ID validation.
- `src/services`: invitation recovery, identity linking and Clerk coordination.
- `src/repositories`: parameterized PostgreSQL queries, transactions and audit/history updates.
- `db`: base schema and incremental migrations.
- `tests`: validation and database workflow tests.

## Checks

`npm test` runs validation/configuration tests; database workflows run only if database environment variables are available. `npm run test:db` loads `.env` and runs workflows against PostgreSQL TEMP tables. The tests need an initialized schema and permission to create temporary tables. They roll back fixture data and replace Clerk with a fake provider; they do not send real email or modify real accounts. An end-to-end test with the team's frontend remains necessary after frontend integration.

## Account management

Organizers manage users, invitations, team state, manager replacement, role/team transfers, soft deletion and restoration. Managers can read members of their own team. Inactive/deleted accounts are blocked. User/team changes preserve assignment history and audit records. Protected-manager and last-Organizer checks apply across endpoints.

See [invitations](docs/account-invitations.md), [editing](docs/user-editing.md) and [deletion](docs/user-deletion.md).

The final database baseline and approved invitation exception are described in [final database integration](docs/final-database.md). Evaluation routes are a separate module; this repository provides account/team administration and its audit/history integration.
