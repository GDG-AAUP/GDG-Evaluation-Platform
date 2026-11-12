// Recovers an account whose stored Clerk ID is missing or wrong, using Clerk's verified email.
const { clerkClient } = require('@clerk/express')
const pool = require('../config/db')
const { recordAudit } = require('../repositories/audit.repository')

const verifiedEmailsOf = (clerkUser) =>
  (clerkUser.emailAddresses || [])
    .filter((address) => address.verification?.status === 'verified')
    .map((address) => address.emailAddress.trim().toLowerCase())

// Returns the matching account, linked when it is usable; inactive or deleted accounts are
// returned unchanged so the caller can refuse them. Returns null when nothing matches.
const linkByVerifiedEmail = async (clerkUserId) => {
  let clerkUser
  try {
    clerkUser = await clerkClient.users.getUser(clerkUserId)
  } catch (cause) {
    if (cause.status === 404) return null
    const error = new Error('Identity provider is temporarily unavailable')
    error.code = 'CLERK_UNAVAILABLE'
    throw error
  }

  const emails = verifiedEmailsOf(clerkUser)
  if (!emails.length) return null

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const found = await client.query(
      `SELECT user_id AS id, full_name AS name, LOWER(role) AS role, team_id AS "teamId",
         is_active AS "isActive", deleted_at AS "deletedAt", clerk_user_id AS "clerkUserId"
       FROM users WHERE LOWER(email) = ANY($1) FOR UPDATE`,
      [emails],
    )
    if (found.rows.length !== 1) {
      await client.query('ROLLBACK')
      return null
    }

    const user = found.rows[0]
    if (user.isActive !== true || user.deletedAt) {
      await client.query('ROLLBACK')
      return user
    }

    await client.query(
      `UPDATE users SET clerk_user_id = $2,
         invitation_status = CASE WHEN invitation_status IN ('pending', 'sending', 'sent', 'failed')
                                  THEN 'accepted' ELSE invitation_status END
       WHERE user_id = $1`,
      [user.id, clerkUserId],
    )
    await recordAudit(client, {
      actorId: null, action: 'link_clerk_account_by_email', entityName: 'users', entityId: user.id,
      before: { identity_linked: user.clerkUserId !== null },
      after: { identity_linked: true },
      reason: 'System matched the verified Clerk email to a project account with a missing or different Clerk ID',
    })
    await client.query('COMMIT')
    return { ...user, clerkUserId }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

module.exports = { linkByVerifiedEmail }
