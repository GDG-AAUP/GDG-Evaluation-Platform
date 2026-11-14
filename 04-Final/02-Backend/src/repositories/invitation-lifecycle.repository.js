// Serializes invitation operations per account without holding transactions during Clerk requests.
const pool = require('../config/db')
const { recordAudit } = require('./audit.repository')
const lockNamespace = 73419

const withInvitationLock = async (userId, operation) => {
  const client = await pool.connect()
  let locked = false
  let releaseError
  try {
    const result = await client.query('SELECT pg_try_advisory_lock($1, $2) AS locked', [lockNamespace, userId])
    locked = result.rows[0].locked
    if (!locked) return { outcome: 'busy', userId }
    return await operation(client)
  } finally {
    if (locked) {
      try {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [lockNamespace, userId])
      } catch (error) {
        releaseError = error
      }
    }
    client.release(releaseError)
  }
}

const readInvitationUser = async (client, userId) => {
  const result = await client.query(
    `SELECT user_id AS id, email, is_active AS "isActive", deleted_at AS "deletedAt", clerk_user_id AS "clerkUserId",
       clerk_invitation_id AS "invitationId", invitation_status AS "invitationStatus", invited_at AS "invitedAt"
     FROM users WHERE user_id = $1`, [userId],
  )
  return result.rows[0] ?? null
}

const isActiveOrganizer = async (client, actorId) => {
  const result = await client.query(
    "SELECT user_id FROM users WHERE user_id = $1 AND role = 'Organizer' AND is_active = TRUE", [actorId],
  )
  return result.rows.length === 1
}

// Compare-and-set preserves concurrent account deactivation and completed identity links.
const changeInvitationState = async (client, user, status, actorId, invitation = null) => {
  await client.query('BEGIN')
  try {
    const result = await client.query(
      `UPDATE users SET invitation_status = $2,
         clerk_invitation_id = CASE WHEN $3::text IS NULL THEN clerk_invitation_id ELSE $3 END,
         invited_at = CASE WHEN $3::text IS NOT NULL AND
           (clerk_invitation_id IS DISTINCT FROM $3 OR invited_at IS NULL) THEN $4::timestamptz ELSE invited_at END
       WHERE user_id = $1 AND clerk_user_id IS NULL AND deleted_at IS NULL
         AND invitation_status = $5 AND email = $6
         AND clerk_invitation_id IS NOT DISTINCT FROM $7::varchar
         AND ($2 <> 'sending' OR is_active = TRUE)
       RETURNING user_id`,
      [user.id, status, invitation?.id ?? null,
        invitation ? new Date(invitation.createdAt) : null,
        user.invitationStatus, user.email, user.invitationId],
    )
    if (!result.rows.length) {
      await client.query('ROLLBACK')
      return null
    }
    if (user.invitationStatus !== status || (invitation && invitation.id !== user.invitationId)) {
      await recordAudit(client, {
        actorId, action: 'change_invitation_status', entityName: 'users', entityId: user.id,
        before: { invitation_status: user.invitationStatus, clerk_invitation_id: user.invitationId },
        after: { invitation_status: status, clerk_invitation_id: invitation?.id ?? user.invitationId },
        reason: 'Invitation lifecycle synchronization',
      })
    }
    await client.query('COMMIT')
    return readInvitationUser(client, user.id)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

const saveAcceptedIdentity = async (client, user, clerkUserId) => {
  await client.query('BEGIN')
  try {
    const result = await client.query(
      `UPDATE users SET clerk_user_id = $2, invitation_status = 'accepted'
       WHERE user_id = $1 AND clerk_user_id IS NULL AND is_active = TRUE AND deleted_at IS NULL
         AND invitation_status = 'sent' AND clerk_invitation_id = $3 AND email = $4
       RETURNING user_id AS id, full_name AS name, LOWER(role) AS role,
         team_id AS "teamId", is_active AS "isActive", clerk_user_id AS "clerkUserId"`,
      [user.id, clerkUserId, user.invitationId, user.email],
    )
    if (!result.rows.length) {
      await client.query('ROLLBACK')
      return null
    }
    await recordAudit(client, {
      actorId: null, action: 'link_clerk_account', entityName: 'users', entityId: user.id,
      before: { invitation_status: 'sent', identity_linked: false },
      after: { invitation_status: 'accepted', identity_linked: true },
      reason: 'System verified accepted invitation and email for the authenticated Clerk identity',
    })
    await client.query('COMMIT')
    return result.rows[0]
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

module.exports = { withInvitationLock, readInvitationUser, isActiveOrganizer, changeInvitationState, saveAcceptedIdentity }
