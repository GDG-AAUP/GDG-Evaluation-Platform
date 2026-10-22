# GDG Backend API

Base URL: `http://localhost:3001`. Business data is stored in PostgreSQL. Send JSON bodies with `Content-Type: application/json`.

## Authentication

Send `Authorization: Bearer <Clerk session token>`. Clerk verifies identity; PostgreSQL supplies current project role, active state and deletion state. Client-supplied roles do not establish identity. Inactive/deleted accounts are blocked. API roles are lowercase; database roles are Organizer, Manager and Member.

## Endpoints

| Method | Path | Access | Body or purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | Public | Server health |
| GET | `/api/ready` | Public | Database readiness |
| GET | `/api/auth/me` | Active linked user | Current account and role |
| POST | `/api/auth/complete-registration` | Clerk session | Empty body `{}`; accepted invitation linking |
| GET | `/api/admin/check` | Organizer | Role check |
| GET | `/api/campuses` | Active linked user | Campus list |
| GET | `/api/campuses/:id` | Active linked user | Campus details |
| GET | `/api/teams` | Active linked user | Optional `campusId` query |
| GET | `/api/teams/:id` | Active linked user | Team details |
| GET | `/api/teams/:id/members` | Organizer or assigned Manager | Active members |
| POST | `/api/teams` | Organizer | `name`, `campusId`, optional `description` |
| PATCH | `/api/teams/:id/status` | Organizer | `isOperational` boolean |
| PATCH | `/api/teams/:id/manager` | Organizer | `managerId`, `expectedManagerId`, `reason` |
| GET | `/api/users` | Organizer | Users excluding deleted accounts |
| POST | `/api/users` | Organizer | `name`, `email`, `role` (member/manager), `teamId` |
| PATCH | `/api/users/:id` | Organizer | Changed `name`, `email`, `role`, `teamId`, `isActive`; required `reason` |
| PATCH | `/api/users/:id/status` | Organizer | `isActive` boolean |
| POST | `/api/users/:id/invitations/review` | Organizer | `{}`; no email sent |
| POST | `/api/users/:id/invitations/resend` | Organizer | `{}`; explicit replacement invitation |
| DELETE | `/api/users/:id` | Organizer | `reason` |
| GET | `/api/users/deleted` | Organizer | Deleted users |
| POST | `/api/users/:id/restore` | Organizer | `reason`; restores inactive account |

Success returns `{ "data": ... }`; creation returns 201. Errors return `{ "error": { "code": "...", "message": "..." } }`. Numeric IDs must fit the positive PostgreSQL integer range.

## Business rules

New teams are nonoperational. Team activation requires an active Manager assigned to that team. Manager replacement requires an active linked Member from the same team, and changes the previous manager to an active Member. `expectedManagerId` protects against stale replacement requests.

Moving, demoting, disabling or deleting an operational team's manager requires a replacement first. The last active Organizer is protected. Organizers have no team; Members and Managers require one. History and audit writes commit with assignment changes.

For a linked account's changed project email, the user must verify the new email on the same Clerk identity first. Soft deletion retains history and Clerk identity; restoration leaves the account inactive. See [editing](user-editing.md) and [deletion](user-deletion.md).

## Frontend integration

This repository serves no frontend pages. Configure `CLERK_INVITATION_REDIRECT_URL` with the frontend acceptance page before dispatching invitations; HTTPS is required outside local development. The frontend handles Clerk invitation tickets using its sign-up/sign-in component, then calls `POST /api/auth/complete-registration` with the recipient's Bearer token and `{}`. Do not use the Organizer's session to link another recipient.

A 201 response confirms local account creation, not inbox delivery. Inspect `data.deliveryStatus`, review uncertain attempts and never repeat account creation as an email retry. Existing invitation links retain their original destination. See [invitations](account-invitations.md).

## Status codes

400 invalid input; 401 missing authentication; 403 access denied; 404 entity/route missing; 409 business conflict; 429 invitation cooldown; 500 unexpected failure; 503 database/provider unavailable or invitation configuration required.
