# Organizer account editing

`PATCH /api/users/:id` requires a verified Clerk session linked to an active Organizer. IDs are positive PostgreSQL integers. Accepted partial fields are `name`, `email`, `role`, `teamId` and `isActive`; a nonempty `reason` of up to 1000 characters is required. Unknown fields, including authentication IDs and password fields, are rejected. Roles use lowercase API values: `organizer`, `manager`, `member`.

```json
{
  "name": "Updated name",
  "role": "member",
  "teamId": 2,
  "reason": "Organizer approved a team transfer"
}
```

An Organizer has no team; promoting a user clears their team automatically unless a contradictory team is explicitly supplied. Members and Managers require an existing team. Changing an operational team's manager role, team or active status is refused until the dedicated replacement operation is used. An occupied manager position cannot be overwritten. The last active Organizer cannot be demoted or disabled.

The operation serializes against invitation operations with the existing advisory lock, then uses the same users → teams → assignment_history locking order as other account mutations. It rechecks the acting Organizer under the database lock. User changes, manager pointers, history boundaries and audit records commit together; history timestamps retain PostgreSQL precision. No-op changes do not add audit records. A role/team change requires consistent existing open history. Point, ranking and evaluation records are retained.

## Email editing

For an already linked account, the new email must exist as a verified email on the **same** Clerk user. Otherwise the API returns `409 EMAIL_VERIFICATION_REQUIRED` and saves none of the submitted fields. The account owner adds and verifies that email using the frontend's Clerk profile component, after which the Organizer saves the new project email. This changes the project's contact email, preserves the Clerk user ID, and does not change which Clerk address is primary. Login identifiers remain managed by Clerk; this operation does not remove the old Clerk email or reset the password.

For an unaccepted account invitation, the service verifies that the new email has no conflicting account/invitation, revokes matching pending invitations for the old email, saves the new email and resets invitation state to `pending`. After commit and release of the account lock it attempts one fresh invitation for an active account. An inactive account remains pending until explicitly activated and sent an invitation. A registered but unlinked account must finish linking first (`409 LINK_ACCOUNT_FIRST`). Conflicting identities are never adopted or reassigned.

Clerk and PostgreSQL do not share a transaction. If revocation may have happened but the email edit cannot commit, the API returns `503 EMAIL_CHANGE_NEEDS_REVIEW`: local edits were not saved and the old invitation may be revoked. Review the old invitation before an explicit retry. It never claims rollback of an external Clerk action. Failure to deliver the fresh invitation after a successful database commit returns `200` for the saved edit with `invitation.deliveryStatus` describing the delivery attempt; review before retrying. A Clerk outage before revocation rejects the edit without local changes.

## Verification

The frontend submits changed fields and a reason to the editing API. This backend does not serve HTML pages.

`npm run test:db` checks authorization, transfers, promotions/demotions, manager pointers, last-Organizer protection, verified emails, pending invitation changes, audit rollback and provider failures using temporary data and a fake Clerk provider.
