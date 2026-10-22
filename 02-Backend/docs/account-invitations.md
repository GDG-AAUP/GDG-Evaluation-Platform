# Account invitations and manager account protection

## Implemented policy

- Only an active Organizer creates Member/Manager accounts and manages their invitations.
- An account has exactly the role and team stored locally; invitation metadata is never accepted as authority to choose a role.
- Deactivating the current Manager of an operational team returns `409 MANAGER_REPLACEMENT_REQUIRED`. Replace that manager first. Team deactivation remains a separate operation.
- These changes do not repair or reactivate existing accounts automatically.

## Workflow

1. `POST /api/users` validates `name`, `email`, `role` (`member`/`manager`) and `teamId`.
2. A database transaction creates the local account, initial assignment and audit records. Existing email returns `409`; it never creates a second local account for retry.
3. After commit, a per-user PostgreSQL advisory lock serializes invitation delivery/review/linking across server processes. It holds no database transaction during Clerk network calls.
4. Clerk invitations are searched by email, paginated, and checked for exact email plus server-written `projectUserId`. A conflicting invitation/account is not adopted silently.
5. A fresh invitation is created with `notify: true` and `ignoreExisting: false`; the Clerk ID and state are recorded in a short audited database transaction.
6. New invitations use the frontend acceptance page configured in `CLERK_INVITATION_REDIRECT_URL`. The frontend handles Clerk sign-up/sign-in, then calls the registration completion API. Existing email links keep their original destination.
7. The frontend sends the authenticated session token to `POST /api/auth/complete-registration` with an empty body. Clerk identity, server-written metadata, verified email, exactly one matching accepted invitation and active local account are checked before linking.
8. Later requests look up the account by `clerk_user_id`. `/api/auth/me` also attempts secure first-access linking for compatibility.

## Endpoints

| Method | Path | Access | Body |
|---|---|---|---|
| POST | `/api/users` | Organizer | `name`, `email`, `role`, `teamId` |
| POST | `/api/users/:id/invitations/review` | Organizer | Empty object or no body |
| POST | `/api/users/:id/invitations/resend` | Organizer | Empty object or no body |
| POST | `/api/auth/complete-registration` | Authenticated Clerk session | Empty object or no body; never supply account IDs, email or roles |
| PATCH | `/api/users/:id/status` | Organizer | Boolean `isActive` only |

Creation returns `201` once the local account is created, even if the email attempt needs review. `invitationStatus` is the actual stored state; `deliveryStatus` describes the delivery attempt. Clerk accepting an invitation request is not proof of inbox delivery.

## Review and recovery

- Review never creates/revokes invitations or sends email. It can reconcile a locally uncertain attempt with an existing matching Clerk invitation.
- If no remote invitation is found, review returns `409 INVITATION_NO_ACTIVE_INVITATION`; explicit resend is required. Do not create the user again.
- An accepted invitation returns `accepted_at_clerk`; the invited user must sign in to complete the identity link. Organizer review does not impersonate the recipient.
- Explicit resend invalidates the matching old pending link before requesting a new email. An already accepted invitation is not revoked or resent.
- A 60-second cooldown applies after the last recorded invitation. A per-account in-flight operation returns `409` and can be retried later.
- Network failures and failed local saves remain uncertain. Review first; there are no blind background retries. An expired or revoked invitation may be retried explicitly.
- Linked accounts do not receive onboarding invitations again. Inactive accounts are never automatically reactivated or linked.
- Provider failures during identity linking return `503 IDENTITY_PROVIDER_UNAVAILABLE`; they never bypass authorization.
- Session advisory locks are released in `finally`; a connection is destroyed if unlocking fails. A process crash releases its PostgreSQL session lock, so the next review can recover state.
- `publicMetadata` contains a non-secret local account ID. No invitation URL, token, password or secret key is returned by these endpoints or stored in audit snapshots.

## Verification

```powershell
npm test
npm run test:db
```

`npm test` runs validation checks and skips database workflows unless connection environment variables are supplied. `npm run test:db` loads `.env` and uses PostgreSQL TEMP tables copied from the schema. Fixture rows, audit records, identity sequences and operations are temporary and rolled back; Clerk is replaced with a fake provider before services load. No real invitations are sent or revoked.

Coverage includes successful linking and repeated access, lost provider response, audit failure recovery, explicit retry, resend cooldown, revoked/expired invitations, conflicting identity, unverified email, inactive accounts, two-connection advisory locking, manager replacement protection, and route authorization.

Automated provider tests do not establish real inbox delivery or frontend behavior. Verify the full invitation flow with the team's frontend after integration.

## Invitation destination

`CLERK_INVITATION_REDIRECT_URL` is required when dispatching a new invitation. It must point to the frontend acceptance page, not this backend. Only HTTPS is accepted in production; local development may use HTTP on localhost. Credentials, query strings and fragments are rejected. Request Host headers never select the destination. Missing configuration returns `configuration_required` without dispatching email. Existing invitations retain their original URLs; explicit resending replaces a pending invitation with the configured destination.
