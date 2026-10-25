// Tests invitation recovery and account protections using disposable PostgreSQL TEMP tables and a fake Clerk provider.
const test = require('node:test')
const assert = require('node:assert/strict')

test('team and account validation reject privileged fields and non-boolean IDs', () => {
  const user = require('../src/validators/create-user.validator')
  const team = require('../src/validators/create-team.validator')
  assert.ok(user({ name: 'Test', email: 'test@example.test', role: 'member', teamId: 1, isActive: true }).error)
  assert.ok(user({ name: 'Test', email: 'test@example.test', role: 'organizer', teamId: 1 }).error)
  assert.ok(team({ name: 'Test', campusId: '1' }).error)
  assert.ok(team({ name: 'Test', campusId: 1, managerId: 2 }).error)
  assert.equal(team({ name: ' Test ', campusId: 1 }).value.name, 'Test')
  const update = require('../src/validators/update-user.validator')
  assert.ok(update({ clerkUserId: 'spoof', reason: 'Test' }).error)
  assert.ok(update({ name: 'Test' }).error)
  assert.ok(update({ teamId: true, reason: 'Test' }).error)
  assert.ok(update({ role: 'organizer', teamId: 1, reason: 'Test' }).error)
  assert.equal(update({ name: ' Test ', email: 'NEW@EXAMPLE.TEST', reason: ' Test ' }).value.email, 'new@example.test')
  const parseId = require('../src/utils/parse-positive-id')
  assert.equal(parseId('2147483648'), null)
  assert.ok(user({ name: 'Test', email: 'test@example.test', role: 'member', teamId: 2147483648 }).error)
  const longEmail = 'a'.repeat(60) + '@' + 'b'.repeat(50) + '.test'
  assert.equal(user({ name: 'Test', email: longEmail, role: 'member', teamId: 1 }).value.email, longEmail)
  assert.equal(update({ email: longEmail, reason: 'Wider schema email' }).value.email, longEmail)
})

test('PostgreSQL account, invitation and registration workflows', {
  skip: !process.env.DB_NAME,
  timeout: 120000,
}, async (t) => {
  const pool = require('../src/config/db')
  const connect = pool.connect.bind(pool)
  const query = pool.query.bind(pool)
  const client = await connect()
  const actorId = 1800000001
  const managerId = 1800000002
  const userId = 1800000003
  const teamId = 1800000001
  let remote, account, calls, failSentAudit, failUserAudit, failDeletionAudit, createFailure, clock

  const fakeClerk = {
    users: {
      getUser: async () => structuredClone(account),
      getUserList: async () => ({ data: [], totalCount: 0 }),
    },
    invitations: {
      getInvitationList: async ({ status, offset = 0, limit }) => {
        const rows = remote.filter((invitation) => invitation.status === status)
        return { data: structuredClone(rows.slice(offset, offset + limit)), totalCount: rows.length }
      },
      createInvitation: async (input) => {
        calls.create++
        if (createFailure === 'before') throw new Error('simulated timeout')
        assert.equal(input.ignoreExisting, false)
        assert.match(input.redirectUrl, /^https?:\/\//)
        assert.notEqual(new URL(input.redirectUrl).hostname, 'dashboard.clerk.com')
        const invitation = {
          id: `inv_${calls.create}`, emailAddress: input.emailAddress,
          publicMetadata: input.publicMetadata, status: 'pending', createdAt: clock,
        }
        remote.push(invitation)
        if (createFailure === 'after') throw new Error('simulated timeout after creation')
        return structuredClone(invitation)
      },
      revokeInvitation: async (id) => {
        calls.revoke++
        const invitation = remote.find((item) => item.id === id)
        invitation.status = 'revoked'
        return structuredClone(invitation)
      },
    },
  }
  // No test has access to the real Clerk client: email/account mutations cannot escape.
  const sdkId = require.resolve('@clerk/express')
  const previousSdk = require.cache[sdkId]
  const previousRedirect = process.env.CLERK_INVITATION_REDIRECT_URL
  process.env.CLERK_INVITATION_REDIRECT_URL = 'https://frontend.example.test/accept-invitation'
  require.cache[sdkId] = { id: sdkId, filename: sdkId, loaded: true, exports: {
    clerkClient: fakeClerk,
    clerkMiddleware: () => (req, res, next) => { req.testUserId = req.headers['x-test-user']; next() },
    getAuth: (req) => ({ userId: req.testUserId || null }),
  } }
  let server
  try {
    await client.query('BEGIN')
    for (const table of ['campuses', 'users', 'teams', 'assignment_history', 'audit_logs', 'performance_evaluations']) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL)`)
      const check = await client.query('SELECT relpersistence FROM pg_class WHERE oid = to_regclass($1)', [`pg_temp.${table}`])
      assert.equal(check.rows[0].relpersistence, 't')
    }
    const operationClient = {
      query: async (text, values) => {
        if (text === 'BEGIN') return client.query('SAVEPOINT workflow_operation')
        if (text === 'COMMIT') return client.query('RELEASE SAVEPOINT workflow_operation')
        if (text === 'ROLLBACK') {
          await client.query('ROLLBACK TO SAVEPOINT workflow_operation')
          return client.query('RELEASE SAVEPOINT workflow_operation')
        }
        if (failSentAudit && text.includes('INSERT INTO audit_logs') &&
            values?.[1] === 'change_invitation_status' && JSON.parse(values[5]).invitation_status === 'sent') {
          throw new Error('simulated sent-state audit failure')
        }
        if (failUserAudit && text.includes('INSERT INTO audit_logs') && values?.[1] === 'update_user') throw new Error('simulated user audit failure')
        if (failDeletionAudit && text.includes('INSERT INTO audit_logs') && ['delete_user', 'restore_user'].includes(values?.[1])) throw new Error('simulated deletion audit failure')
        return client.query(text, values)
      },
      release: () => {},
    }
    pool.connect = async () => operationClient
    pool.query = (text, values) => client.query(text, values)

    const delivery = require('../src/services/user-invitations.service')
    const { linkClerkAccount } = require('../src/services/link-clerk-account.service')
    const lifecycle = require('../src/repositories/invitation-lifecycle.repository')
    const users = require('../src/repositories/users.repository')
    const { replaceTeamManager } = require('../src/repositories/team-manager.repository')
    const updates = require('../src/services/update-user.service')
    const deletions = require('../src/repositories/user-deletion.repository')
    const read = () => lifecycle.readInvitationUser(client, userId)

    const reset = async () => {
      await client.query('TRUNCATE pg_temp.audit_logs, pg_temp.assignment_history, pg_temp.teams, pg_temp.users, pg_temp.campuses RESTART IDENTITY')
      await client.query("INSERT INTO campuses(campus_id,campus_name) VALUES (1,'Test campus')")
      await client.query(`INSERT INTO users(user_id,full_name,email,role,team_id,is_active,clerk_user_id,invitation_status)
        VALUES ($1,'Organizer','org@example.test','Organizer',NULL,TRUE,'clerk_org','not_required'),
        ($2,'Old manager','manager@example.test','Manager',$4,TRUE,'clerk_old','not_required'),
        ($3,'Invited member','invited@example.test','Member',$4,TRUE,NULL,'pending')`,
      [actorId, managerId, userId, teamId])
      await client.query(`INSERT INTO teams(team_id,campus_id,team_name,manager_user_id,is_operational)
        VALUES($1,1,'Test team',$2,TRUE)`, [teamId, managerId])
      await client.query(`INSERT INTO assignment_history(user_id,team_id,role_at_time,effective_from)
        VALUES($1,$3,'Manager',CURRENT_TIMESTAMP-INTERVAL '1 day'),($2,$3,'Member',CURRENT_TIMESTAMP-INTERVAL '1 day')`,
      [managerId, userId, teamId])
      remote = []
      account = { id: 'clerk_invited', publicMetadata: { projectUserId: String(userId) },
        emailAddresses: [{ emailAddress: 'invited@example.test', verification: { status: 'verified' } }] }
      calls = { create: 0, revoke: 0 }
      failSentAudit = false
      failUserAudit = false
      failDeletionAudit = false
      createFailure = null
      clock = Date.now() - 120000
    }

    await t.test('fresh send, repeated send, review, acceptance and idempotent linking', async () => {
      await reset()
      assert.equal((await delivery.sendUserInvitation(userId, actorId)).outcome, 'sent')
      assert.equal((await read()).invitationStatus, 'sent')
      assert.equal((await delivery.sendUserInvitation(userId, actorId)).outcome, 'existing_invitation')
      assert.equal((await delivery.reviewUserInvitation(userId, actorId)).outcome, 'existing_invitation')
      assert.equal(calls.create, 1)
      remote[0].status = 'accepted'
      assert.equal((await linkClerkAccount('clerk_invited')).id, userId)
      assert.equal((await read()).invitationStatus, 'accepted')
      assert.equal((await linkClerkAccount('clerk_invited')).id, userId)
      const logs = await client.query("SELECT * FROM audit_logs WHERE action='link_clerk_account'")
      assert.equal(logs.rows.length, 1)
      assert.ok(!JSON.stringify(logs.rows).includes('clerk_invited'))
    })

    await t.test('four-criterion evaluations support multiple occurrences and enforce database constraints', async () => {
      await reset()

      const scores83 = [85, 80, 90, 75]
      const scores69 = [70, 65, 80, 60]

      const insert = input => client.query(
        `INSERT INTO performance_evaluations
         (evaluated_user_id, evaluated_by_user_id, team_id,
          campus_id, activity_name, activity_date,
          criteria_scores, criteria_total_score)
         VALUES ($1, $2, $3, 1, 'Workshop',
                 CURRENT_TIMESTAMP, $4::jsonb, $5)
         RETURNING evaluation_id`,
        [managerId, actorId, teamId,
         JSON.stringify(input.scores), input.total]
      )

      await insert({ scores: scores83, total: 83 })
      await insert({ scores: scores69, total: 69 })

      const result = await client.query(
        `SELECT COUNT(*)::int AS count,
                AVG(criteria_total_score)::numeric AS average
         FROM performance_evaluations
         WHERE evaluated_user_id = $1`,
        [managerId]
      )

      assert.equal(result.rows[0].count, 2)
      assert.equal(Number(result.rows[0].average), 76)

      const invalidInputs = [
        { scores: scores83.slice(1), total: 83 },
        { scores: [...scores83, 0], total: 83 },
        { scores: Array(15).fill(5), total: 75 },
        { scores: scores83, total: 101 }
      ]

      for (const invalid of invalidInputs) {
        await client.query('SAVEPOINT invalid_evaluation')

        try {
          await assert.rejects(
            insert(invalid),
            error => error.code === '23514'
          )
        } finally {
          await client.query('ROLLBACK TO SAVEPOINT invalid_evaluation')
          await client.query('RELEASE SAVEPOINT invalid_evaluation')
        }
      }

      const finalCount = await client.query(
        'SELECT COUNT(*)::int AS count FROM performance_evaluations'
      )
      assert.equal(finalCount.rows[0].count, 2)
    })

    await t.test('missing frontend destination never dispatches an invitation or marks it sending', async () => {
      await reset()
      const configured = process.env.CLERK_INVITATION_REDIRECT_URL
      delete process.env.CLERK_INVITATION_REDIRECT_URL
      try {
        assert.equal((await delivery.sendUserInvitation(userId, actorId)).outcome, 'configuration_required')
        assert.equal(calls.create, 0); assert.equal((await read()).invitationStatus, 'pending')
      } finally { process.env.CLERK_INVITATION_REDIRECT_URL = configured }
    })

    await t.test('timeout after Clerk creation is recovered without another email', async () => {
      await reset(); createFailure = 'after'
      assert.equal((await delivery.sendUserInvitation(userId, actorId)).outcome, 'needs_review')
      assert.equal((await read()).invitationStatus, 'sending')
      createFailure = null
      assert.equal((await delivery.reviewUserInvitation(userId, actorId)).outcome, 'existing_invitation')
      assert.equal(calls.create, 1)
      assert.equal((await read()).invitationId, remote[0].id)
    })

    await t.test('uncertain attempt with no remote invite requires explicit retry', async () => {
      await reset(); createFailure = 'before'
      await delivery.sendUserInvitation(userId, actorId)
      assert.equal((await delivery.reviewUserInvitation(userId, actorId)).outcome, 'no_active_invitation')
      assert.equal(calls.create, 1)
      createFailure = null
      assert.equal((await delivery.resendUserInvitation(userId, actorId)).outcome, 'sent')
      assert.equal(remote.length, 1)
    })

    await t.test('resend revokes the old link, enforces cooldown and never recreates accepted invitations', async () => {
      await reset(); await delivery.sendUserInvitation(userId, actorId)
      clock = Date.now()
      assert.equal((await delivery.resendUserInvitation(userId, actorId)).outcome, 'sent')
      assert.equal(remote[0].status, 'revoked'); assert.equal(calls.revoke, 1)
      assert.equal((await delivery.resendUserInvitation(userId, actorId)).outcome, 'cooldown')
      remote[1].status = 'accepted'
      assert.equal((await delivery.resendUserInvitation(userId, actorId)).outcome, 'accepted_at_clerk')
      assert.equal(calls.create, 2); assert.equal(calls.revoke, 1)
    })

    await t.test('expired and revoked invitations can be replaced explicitly', async () => {
      for (const status of ['expired', 'revoked']) {
        await reset(); await delivery.sendUserInvitation(userId, actorId)
        remote[0].status = status
        assert.equal((await delivery.resendUserInvitation(userId, actorId)).outcome, 'sent')
        assert.equal(calls.revoke, 0); assert.equal(calls.create, 2)
      }
    })

    await t.test('audit failure leaves an uncertain attempt recoverable, never falsely failed', async () => {
      await reset(); failSentAudit = true
      assert.equal((await delivery.sendUserInvitation(userId, actorId)).outcome, 'needs_review')
      assert.equal((await read()).invitationStatus, 'sending')
      failSentAudit = false
      remote[0].status = 'accepted'
      assert.equal((await linkClerkAccount('clerk_invited')).id, userId)
      assert.equal(calls.create, 1)
    })

    await t.test('unverified email, wrong metadata, unaccepted invitation and inactive account cannot link', async () => {
      await reset(); await delivery.sendUserInvitation(userId, actorId)
      assert.equal(await linkClerkAccount('clerk_invited'), null)
      remote[0].status = 'accepted'
      account.emailAddresses[0].verification.status = 'unverified'
      assert.equal(await linkClerkAccount('clerk_invited'), null)
      account.emailAddresses[0].verification.status = 'verified'
      account.publicMetadata.projectUserId = '999'
      assert.equal(await linkClerkAccount('clerk_invited'), null)
      account.publicMetadata.projectUserId = String(userId)
      await client.query('UPDATE users SET is_active=FALSE WHERE user_id=$1', [userId])
      assert.equal(await linkClerkAccount('clerk_invited'), null)
      assert.equal((await delivery.resendUserInvitation(userId, actorId)).outcome, 'inactive')
      assert.equal(calls.create, 1)
    })

    await t.test('foreign invitation and existing identity are not silently adopted', async () => {
      await reset()
      remote.push({ id: 'foreign', emailAddress: 'invited@example.test', publicMetadata: { projectUserId: '123' }, status: 'pending', createdAt: clock })
      assert.equal((await delivery.sendUserInvitation(userId, actorId)).outcome, 'identity_conflict')
      assert.equal(calls.create, 0)
      remote = []
      const original = fakeClerk.users.getUserList
      fakeClerk.users.getUserList = async () => ({ data: [{ emailAddresses: [{ emailAddress: 'invited@example.test' }] }] })
      try { assert.equal((await delivery.sendUserInvitation(userId, actorId)).outcome, 'identity_conflict') }
      finally { fakeClerk.users.getUserList = original }
      assert.equal(calls.create, 0)
    })

    await t.test('per-account lock excludes a second PostgreSQL connection', async () => {
      await reset()
      await lifecycle.withInvitationLock(userId, async () => {
        pool.connect = connect
        try {
          const result = await lifecycle.withInvitationLock(userId, () => { throw new Error('Second operation must not run') })
          assert.equal(result.outcome, 'busy')
        } finally { pool.connect = async () => operationClient }
      })
      const unlocked = await lifecycle.withInvitationLock(userId, async () => 'released')
      assert.equal(unlocked, 'released')
    })

    await t.test('manager deactivation is blocked until replacement; organizer protection remains', async () => {
      await reset()
      assert.equal((await users.setUserActiveStatus(managerId, false, actorId)).outcome, 'manager_replacement_required')
      assert.equal((await users.setUserActiveStatus(actorId, false, actorId)).outcome, 'last_organizer')
      await client.query("UPDATE users SET clerk_user_id='linked_member' WHERE user_id=$1", [userId])
      assert.equal((await replaceTeamManager(teamId, { managerId: userId, expectedManagerId: managerId, reason: 'Test' }, actorId)).outcome, 'replaced')
      assert.equal((await users.setUserActiveStatus(managerId, false, actorId)).outcome, 'updated')
      assert.equal((await client.query('SELECT is_operational FROM teams WHERE team_id=$1', [teamId])).rows[0].is_operational, true)
    })

    await t.test('organizer edits name and status together; unchanged requests do not add audit', async () => {
      await reset()
      let result = await updates.updateUser(userId, { name: 'Renamed', isActive: false, reason: 'Test edit' }, actorId)
      assert.equal(result.outcome, 'updated')
      assert.equal(result.user.name, 'Renamed'); assert.equal(result.user.isActive, false)
      result = await updates.updateUser(userId, { name: 'Renamed', reason: 'No change' }, actorId)
      assert.equal(result.changed, false)
      assert.equal((await client.query("SELECT count(*)::int AS n FROM audit_logs WHERE action='update_user'")).rows[0].n, 1)
      assert.equal((await updates.updateUser(userId, { name: 'Spoof', reason: 'Denied' }, managerId)).outcome, 'actor_forbidden')
    })

    await t.test('member transfer closes history precisely and opens the new assignment', async () => {
      await reset()
      await client.query("INSERT INTO teams(team_id,campus_id,team_name,is_operational) VALUES($1,1,'Destination',FALSE)", [teamId + 1])
      const result = await updates.updateUser(userId, { teamId: teamId + 1, reason: 'Member transfer' }, actorId)
      assert.equal(result.outcome, 'updated'); assert.equal(result.user.teamId, teamId + 1)
      const history = (await client.query('SELECT team_id,effective_from::text AS start,effective_to::text AS finish FROM assignment_history WHERE user_id=$1 ORDER BY effective_from', [userId])).rows
      assert.equal(history.length, 2); assert.equal(history[0].finish, history[1].start)
      assert.equal(history[1].team_id, teamId + 1); assert.equal(history[1].finish, null)
    })

    await t.test('role changes assign and clear manager slot while preserving team and history', async () => {
      await reset()
      await client.query("INSERT INTO teams(team_id,campus_id,team_name,is_operational) VALUES($1,1,'Destination',FALSE)", [teamId + 1])
      let result = await updates.updateUser(userId, { role: 'manager', teamId: teamId + 1, reason: 'Promote' }, actorId)
      assert.equal(result.outcome, 'updated'); assert.equal(result.user.role, 'manager')
      assert.equal((await client.query('SELECT manager_user_id FROM teams WHERE team_id=$1', [teamId + 1])).rows[0].manager_user_id, userId)
      result = await updates.updateUser(userId, { role: 'organizer', reason: 'Promote organizer' }, actorId)
      assert.equal(result.user.role, 'organizer'); assert.equal(result.user.teamId, null)
      assert.equal((await client.query('SELECT manager_user_id FROM teams WHERE team_id=$1', [teamId + 1])).rows[0].manager_user_id, null)
      assert.equal((await client.query('SELECT count(*)::int AS n FROM assignment_history WHERE user_id=$1 AND effective_to IS NULL', [userId])).rows[0].n, 0)
      result = await updates.updateUser(userId, { role: 'member', teamId, reason: 'Return to team' }, actorId)
      assert.equal(result.user.role, 'member'); assert.equal(result.user.teamId, teamId)
    })

    await t.test('manager replacement and last-organizer protections cannot be bypassed through edit', async () => {
      await reset()
      for (const patch of [{ role: 'member' }, { role: 'organizer' }, { isActive: false }]) {
        assert.equal((await updates.updateUser(managerId, { ...patch, name: 'Must not save', reason: 'Test' }, actorId)).outcome, 'manager_replacement_required')
      }
      assert.equal((await updates.updateUser(userId, { role: 'manager', reason: 'Occupied team' }, actorId)).outcome, 'manager_exists')
      assert.equal((await updates.updateUser(actorId, { role: 'member', teamId, reason: 'Last organizer' }, actorId)).outcome, 'last_organizer')
      assert.equal((await updates.updateUser(actorId, { isActive: false, reason: 'Last organizer' }, actorId)).outcome, 'last_organizer')
      assert.equal((await client.query('SELECT full_name FROM users WHERE user_id=$1', [managerId])).rows[0].full_name, 'Old manager')
    })

    await t.test('invalid team, duplicate email and corrupted history reject the entire edit', async () => {
      await reset()
      assert.equal((await updates.updateUser(userId, { email: 'ORG@example.test', reason: 'Duplicate' }, actorId)).outcome, 'email_exists')
      assert.equal((await updates.updateUser(userId, { teamId: 1999999999, reason: 'Missing team' }, actorId)).outcome, 'team_not_found')
      await client.query('DELETE FROM assignment_history WHERE user_id=$1', [userId])
      assert.equal((await updates.updateUser(userId, { role: 'organizer', reason: 'Bad history' }, actorId)).outcome, 'history_conflict')
    })

    await t.test('linked email change requires verified ownership on the same Clerk identity', async () => {
      await reset()
      await client.query("UPDATE users SET clerk_user_id='clerk_invited',invitation_status='accepted' WHERE user_id=$1", [userId])
      assert.equal((await updates.updateUser(userId, { email: 'new@example.test', reason: 'Email edit' }, actorId)).outcome, 'email_verification_required')
      account.emailAddresses.push({ emailAddress: 'new@example.test', verification: { status: 'unverified' } })
      assert.equal((await updates.updateUser(userId, { email: 'new@example.test', reason: 'Email edit' }, actorId)).outcome, 'email_verification_required')
      account.emailAddresses[1].verification.status = 'verified'
      const result = await updates.updateUser(userId, { email: 'new@example.test', reason: 'Verified email edit' }, actorId)
      assert.equal(result.outcome, 'updated'); assert.equal(result.user.email, 'new@example.test')
      assert.equal((await read()).clerkUserId, 'clerk_invited'); assert.equal((await read()).invitationStatus, 'accepted')
      assert.equal(calls.create, 0); assert.equal(calls.revoke, 0)
    })

    await t.test('pending email edit revokes old invite and sends one new invite after commit', async () => {
      await reset(); await delivery.sendUserInvitation(userId, actorId)
      const result = await updates.updateUser(userId, { email: 'new@example.test', reason: 'Correct pending email' }, actorId)
      assert.equal(result.outcome, 'updated'); assert.equal(result.delivery.outcome, 'sent')
      assert.equal(remote[0].status, 'revoked'); assert.equal(remote[1].emailAddress, 'new@example.test')
      assert.equal((await read()).email, 'new@example.test'); assert.equal(calls.create, 2)
    })

    await t.test('accepted unlinked accounts must link first; inactive edits do not send mail', async () => {
      await reset(); await delivery.sendUserInvitation(userId, actorId); remote[0].status = 'accepted'
      assert.equal((await updates.updateUser(userId, { email: 'new@example.test', reason: 'Too early' }, actorId)).outcome, 'link_account_first')
      assert.equal((await read()).email, 'invited@example.test')
      await reset()
      const result = await updates.updateUser(userId, { email: 'new@example.test', isActive: false, reason: 'Inactive edit' }, actorId)
      assert.equal(result.outcome, 'updated'); assert.equal(result.delivery, undefined)
      assert.equal(calls.create, 0); assert.equal((await read()).invitationStatus, 'pending')
    })

    await t.test('Clerk outage refuses linked email and all other fields in the same request', async () => {
      await reset()
      await client.query("UPDATE users SET clerk_user_id='clerk_invited' WHERE user_id=$1", [userId])
      const original = fakeClerk.users.getUser
      fakeClerk.users.getUser = async () => { throw new Error('simulated provider outage') }
      try {
        const result = await updates.updateUser(userId, { name: 'Must not save', email: 'new@example.test', isActive: false, reason: 'Provider outage' }, actorId)
        assert.equal(result.outcome, 'identity_provider_unavailable')
        const row = (await client.query('SELECT full_name,email,is_active FROM users WHERE user_id=$1', [userId])).rows[0]
        assert.equal(row.full_name, 'Invited member'); assert.equal(row.email, 'invited@example.test'); assert.equal(row.is_active, true)
      } finally { fakeClerk.users.getUser = original }
    })

    await t.test('audit failure after invitation revocation reports uncertainty without sending to new email', async () => {
      await reset(); await delivery.sendUserInvitation(userId, actorId)
      failUserAudit = true
      const result = await updates.updateUser(userId, { email: 'new@example.test', reason: 'Audit outage' }, actorId)
      failUserAudit = false
      assert.equal(result.outcome, 'email_change_needs_review')
      assert.equal((await read()).email, 'invited@example.test')
      assert.equal(remote[0].status, 'revoked'); assert.equal(calls.create, 1)
    })

    await t.test('uncertain revocation stops email change even if Clerk performed the revocation', async () => {
      await reset(); await delivery.sendUserInvitation(userId, actorId)
      const original = fakeClerk.invitations.revokeInvitation
      fakeClerk.invitations.revokeInvitation = async id => { await original(id); throw new Error('simulated lost revoke response') }
      try {
        const result = await updates.updateUser(userId, { email: 'new@example.test', reason: 'Lost response' }, actorId)
        assert.equal(result.outcome, 'email_change_needs_review')
        assert.equal((await read()).email, 'invited@example.test'); assert.equal(calls.create, 1)
      } finally { fakeClerk.invitations.revokeInvitation = original }
    })

    await t.test('audit failure rolls back account, team and assignment changes together', async () => {
      await reset()
      await client.query("INSERT INTO teams(team_id,campus_id,team_name,is_operational) VALUES($1,1,'Destination',FALSE)", [teamId + 1])
      failUserAudit = true
      await assert.rejects(updates.updateUser(userId, { name: 'Must roll back', role: 'manager', teamId: teamId + 1, reason: 'Audit failure' }, actorId))
      failUserAudit = false
      const user = (await client.query('SELECT full_name,role,team_id FROM users WHERE user_id=$1', [userId])).rows[0]
      assert.equal(user.full_name, 'Invited member'); assert.equal(user.role, 'Member'); assert.equal(user.team_id, teamId)
      assert.equal((await client.query('SELECT manager_user_id FROM teams WHERE team_id=$1', [teamId + 1])).rows[0].manager_user_id, null)
      assert.equal((await client.query('SELECT count(*)::int AS n FROM assignment_history WHERE user_id=$1', [userId])).rows[0].n, 1)
    })

    await t.test('soft deletion retains identity and history, hides account and refuses edits or activation', async () => {
      await reset()
      await client.query("UPDATE users SET clerk_user_id='clerk_invited',invitation_status='accepted' WHERE user_id=$1", [userId])
      const result = await deletions.deleteUser(userId, actorId, 'Test deletion')
      assert.equal(result.outcome, 'deleted'); assert.equal(result.user.isActive, false); assert.ok(result.user.deletedAt)
      assert.equal((await users.listUsers()).some(user => user.id === userId), false)
      assert.equal((await users.listUsers({ deleted: true })).some(user => user.id === userId), true)
      const retained = (await client.query('SELECT clerk_user_id,email,team_id FROM users WHERE user_id=$1', [userId])).rows[0]
      assert.equal(retained.clerk_user_id, 'clerk_invited'); assert.equal(retained.email, 'invited@example.test'); assert.equal(retained.team_id, teamId)
      const history = (await client.query('SELECT * FROM assignment_history WHERE user_id=$1', [userId])).rows
      assert.equal(history.length, 1); assert.ok(history[0].effective_to)
      assert.equal((await users.setUserActiveStatus(userId, true, actorId)).outcome, 'deleted')
      assert.equal((await updates.updateUser(userId, { name: 'Bypass', isActive: true, reason: 'Denied' }, actorId)).outcome, 'deleted')
      assert.equal((await delivery.resendUserInvitation(userId, actorId)).outcome, 'deleted')
      assert.equal(await linkClerkAccount('clerk_invited'), null)
    })

    await t.test('repeat deletion is idempotent and restoration requires separate activation', async () => {
      await reset()
      await deletions.deleteUser(userId, actorId, 'First deletion')
      const repeat = await deletions.deleteUser(userId, actorId, 'Repeated deletion')
      assert.equal(repeat.changed, false)
      assert.equal((await client.query("SELECT count(*)::int AS n FROM audit_logs WHERE action='delete_user'")).rows[0].n, 1)
      const restored = await deletions.restoreUser(userId, actorId, 'Restore')
      assert.equal(restored.outcome, 'restored'); assert.equal(restored.user.isActive, false); assert.equal(restored.user.deletedAt, null)
      assert.equal((await users.listUsers()).some(user => user.id === userId), true)
      const history = (await client.query('SELECT * FROM assignment_history WHERE user_id=$1 ORDER BY effective_from', [userId])).rows
      assert.equal(history.length, 2); assert.equal(history[1].effective_to, null)
      assert.ok(history[1].effective_from >= history[0].effective_to)
      assert.equal((await deletions.restoreUser(userId, actorId, 'Again')).outcome, 'not_deleted')
      assert.equal((await users.setUserActiveStatus(userId, true, actorId)).outcome, 'updated')
    })

    await t.test('last active organizer and operational manager cannot be deleted', async () => {
      await reset()
      assert.equal((await deletions.deleteUser(actorId, actorId, 'Denied')).outcome, 'last_organizer')
      assert.equal((await deletions.deleteUser(managerId, actorId, 'Denied')).outcome, 'manager_replacement_required')
      assert.equal((await deletions.deleteUser(userId, managerId, 'Denied')).outcome, 'actor_forbidden')
      assert.equal((await deletions.deleteUser(1999999999, actorId, 'Missing')).outcome, 'not_found')
      assert.equal((await client.query('SELECT count(*)::int AS n FROM users WHERE deleted_at IS NOT NULL')).rows[0].n, 0)
    })

    await t.test('deleting a nonoperational manager releases the slot; restoration refuses occupied slot', async () => {
      await reset()
      await client.query('UPDATE teams SET is_operational=FALSE WHERE team_id=$1', [teamId])
      assert.equal((await deletions.deleteUser(managerId, actorId, 'Delete manager')).outcome, 'deleted')
      assert.equal((await client.query('SELECT manager_user_id FROM teams WHERE team_id=$1', [teamId])).rows[0].manager_user_id, null)
      assert.equal((await updates.updateUser(userId, { role: 'manager', reason: 'Fill vacancy' }, actorId)).outcome, 'updated')
      assert.equal((await deletions.restoreUser(managerId, actorId, 'Occupied')).outcome, 'manager_restore_conflict')
      assert.equal((await users.listUsers({ deleted: true })).some(user => user.id === managerId), true)
      assert.equal((await updates.updateUser(userId, { role: 'member', reason: 'Free vacancy' }, actorId)).outcome, 'updated')
      const restore = await deletions.restoreUser(managerId, actorId, 'Restore original manager')
      assert.equal(restore.outcome, 'restored'); assert.equal(restore.user.isActive, false)
      assert.equal((await client.query('SELECT manager_user_id FROM teams WHERE team_id=$1', [teamId])).rows[0].manager_user_id, managerId)
    })

    await t.test('deletion and restoration audit failures roll back history, account and manager pointer', async () => {
      await reset()
      await client.query('UPDATE teams SET is_operational=FALSE WHERE team_id=$1', [teamId])
      failDeletionAudit = true
      await assert.rejects(deletions.deleteUser(managerId, actorId, 'Audit failure'))
      failDeletionAudit = false
      assert.equal((await client.query('SELECT deleted_at FROM users WHERE user_id=$1', [managerId])).rows[0].deleted_at, null)
      assert.equal((await client.query('SELECT manager_user_id FROM teams WHERE team_id=$1', [teamId])).rows[0].manager_user_id, managerId)
      assert.equal((await client.query('SELECT count(*)::int AS n FROM assignment_history WHERE user_id=$1 AND effective_to IS NULL', [managerId])).rows[0].n, 1)
      await deletions.deleteUser(managerId, actorId, 'Successful delete')
      failDeletionAudit = true
      await assert.rejects(deletions.restoreUser(managerId, actorId, 'Audit failure'))
      failDeletionAudit = false
      assert.ok((await client.query('SELECT deleted_at FROM users WHERE user_id=$1', [managerId])).rows[0].deleted_at)
      assert.equal((await client.query('SELECT manager_user_id FROM teams WHERE team_id=$1', [teamId])).rows[0].manager_user_id, null)
      assert.equal((await client.query('SELECT count(*)::int AS n FROM assignment_history WHERE user_id=$1 AND effective_to IS NULL', [managerId])).rows[0].n, 0)
    })

    await t.test('database constraint prevents activating deleted users outside the API', async () => {
      await reset(); await deletions.deleteUser(userId, actorId, 'Delete')
      await client.query('SAVEPOINT invalid_activation')
      await assert.rejects(client.query('UPDATE users SET is_active=TRUE WHERE user_id=$1', [userId]), error => error.code === '23514')
      await client.query('ROLLBACK TO SAVEPOINT invalid_activation')
      await client.query('RELEASE SAVEPOINT invalid_activation')
    })

    await t.test('real Express routes enforce roles and complete registration using session identity only', async () => {
      await reset(); await delivery.sendUserInvitation(userId, actorId); remote[0].status = 'accepted'
      const app = require('../src/app')
      server = app.listen(0, '127.0.0.1')
      await new Promise((resolve) => server.once('listening', resolve))
      const base = `http://127.0.0.1:${server.address().port}`
      for (const removedPath of ['/dev/auth-test', '/dev/auth-test/config', '/dev/auth-test/accept-invitation']) {
        const removed = await fetch(base + removedPath)
        assert.equal(removed.status, 404)
      }
      const request = async (path, identity, body = {}) => {
        const response = await fetch(base + path, { method: 'POST', headers: {
          'Content-Type': 'application/json', ...(identity ? { 'x-test-user': identity } : {}),
        }, body: JSON.stringify(body) })
        return { status: response.status, body: await response.json() }
      }
      assert.equal((await request('/api/auth/complete-registration', null)).status, 401)
      assert.equal((await request('/api/auth/complete-registration', 'clerk_invited', { role: 'organizer' })).status, 400)
      let response = await request('/api/auth/complete-registration', 'clerk_invited')
      assert.equal(response.status, 200); assert.equal(response.body.data.role, 'member')
      assert.equal((await request(`/api/users/${userId}/invitations/resend`, 'clerk_invited')).status, 403)
      assert.equal((await request(`/api/users/${userId}/invitations/review`, 'clerk_org')).status, 200)
      response = await request(`/api/users/${userId}/invitations/review`, 'clerk_org', { email: 'other@example.test' })
      assert.equal(response.status, 400)
      assert.equal((await request('/api/users/999/invitations/review', 'clerk_org')).status, 404)
      const edit = async (identity, body, target = userId) => {
        const response = await fetch(base + `/api/users/${target}`, { method: 'PATCH', headers: {
          'Content-Type': 'application/json', ...(identity ? { 'x-test-user': identity } : {}),
        }, body: JSON.stringify(body) })
        return { status: response.status, body: await response.json() }
      }
      assert.equal((await edit(null, { name: 'Test', reason: 'Test' })).status, 401)
      assert.equal((await edit('clerk_invited', { role: 'organizer', reason: 'Spoof' })).status, 403)
      assert.equal((await edit('clerk_org', { clerkUserId: 'spoof', reason: 'Spoof' })).status, 400)
      assert.equal((await edit('clerk_org', { name: 'Test' })).status, 400)
      const edited = await edit('clerk_org', { name: 'Edited through API', reason: 'API test' })
      assert.equal(edited.status, 200); assert.equal(edited.body.data.name, 'Edited through API')
      assert.equal((await edit('clerk_org', { isActive: false, reason: 'Protected' }, managerId)).body.error.code, 'MANAGER_REPLACEMENT_REQUIRED')
      assert.equal((await edit('clerk_org', { name: 'Missing', reason: 'Test' }, 1999999999)).status, 404)
      const deleteOrRestore = async (method, path, identity, body = { reason: 'API lifecycle test' }) => {
        const response = await fetch(base + path, { method, headers: {
          'Content-Type': 'application/json', ...(identity ? { 'x-test-user': identity } : {}),
        }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) })
        return { status: response.status, body: await response.json() }
      }
      assert.equal((await deleteOrRestore('DELETE', `/api/users/${userId}`, null)).status, 401)
      assert.equal((await deleteOrRestore('DELETE', `/api/users/${userId}`, 'clerk_invited')).status, 403)
      assert.equal((await deleteOrRestore('DELETE', `/api/users/${userId}`, 'clerk_org', { reason: 'Test', isActive: true })).status, 400)
      assert.equal((await deleteOrRestore('DELETE', `/api/users/${actorId}`, 'clerk_org')).body.error.code, 'LAST_ACTIVE_ORGANIZER')
      assert.equal((await deleteOrRestore('DELETE', `/api/users/${managerId}`, 'clerk_org')).body.error.code, 'MANAGER_REPLACEMENT_REQUIRED')
      assert.equal((await deleteOrRestore('DELETE', `/api/users/${userId}`, 'clerk_org')).status, 200)
      const deletedList = await deleteOrRestore('GET', '/api/users/deleted', 'clerk_org')
      assert.equal(deletedList.status, 200); assert.ok(deletedList.body.data.some(user => user.id === userId))
      assert.ok(!JSON.stringify(deletedList.body).includes('clerkUserId'))
      assert.equal((await request('/api/auth/complete-registration', 'clerk_invited')).status, 403)
      assert.equal((await edit('clerk_org', { isActive: true, reason: 'Bypass' })).body.error.code, 'USER_DELETED')
      assert.equal((await deleteOrRestore('POST', `/api/users/${userId}/restore`, 'clerk_invited')).status, 403)
      const restored = await deleteOrRestore('POST', `/api/users/${userId}/restore`, 'clerk_org')
      assert.equal(restored.status, 200); assert.equal(restored.body.data.isActive, false)
      assert.equal((await request('/api/auth/complete-registration', 'clerk_invited')).status, 403)
      assert.equal((await users.setUserActiveStatus(userId, true, actorId)).outcome, 'updated')
      assert.equal((await request('/api/auth/complete-registration', 'clerk_invited')).status, 200)
      await client.query('UPDATE users SET is_active=FALSE WHERE user_id=$1', [userId])
      assert.equal((await request('/api/auth/complete-registration', 'clerk_invited')).status, 403)
    })
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve))
    pool.connect = connect
    pool.query = query
    await client.query('ROLLBACK')
    client.release()
    await pool.end()
    if (previousSdk) require.cache[sdkId] = previousSdk
    else delete require.cache[sdkId]
    if (previousRedirect === undefined) delete process.env.CLERK_INVITATION_REDIRECT_URL
    else process.env.CLERK_INVITATION_REDIRECT_URL = previousRedirect
  }
})
