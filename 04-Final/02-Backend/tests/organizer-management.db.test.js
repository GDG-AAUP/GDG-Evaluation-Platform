// Undoing a mistaken Organizer promotion, against real PostgreSQL (throwaway schema; Clerk faked).
// Governance (migration 011): only a Super Admin (SUPER_ADMIN_CLERK_IDS) manages Organizer accounts,
// and Super Admin accounts themselves are never changed through the API.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');

const SCHEMA = `orgs_${process.pid}_${Date.now()}`;

test('organizer accounts: list, demote, deactivate, never lock out', { skip: !process.env.DB_NAME, timeout: 90000 }, async (t) => {
  const previousSuperAdmins = process.env.SUPER_ADMIN_CLERK_IDS;
  process.env.SUPER_ADMIN_CLERK_IDS = ' clerk_9 , clerk_unused ';
  const pool = new Pool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: `-c search_path=${SCHEMA},public -c timezone=Asia/Hebron`,
  });
  let currentAuth = {};
  const replace = (id, exports) => {
    require.cache[require.resolve(id)] = { id, filename: id, loaded: true, exports };
  };
  replace('../src/config/db', pool);
  replace('@clerk/express', {
    getAuth: () => currentAuth,
    clerkClient: { users: { getUser: async () => Promise.reject({ status: 404 }) },
      invitations: { getInvitationList: async () => ({ data: [] }) } },
  });
  const usersRoutes = require('../src/routes/users.routes');

  const dbDir = path.join(__dirname, '..', 'db');
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  for (const file of [
    'GDG_evaluation_database.final.postgresql.sql',
    ...['002_user_invitations', '003_user_soft_delete', '004_final_backend_schema',
      '005_manager_evaluation_four_criteria', '006_asia_hebron_timestamps',
      '007_snapshot_rows_per_team_and_campus', '008_enable_remaining_modules',
      '009_registration_approval_flow', '010_points_spec_alignment', '011_governance_and_super_admin', '012_registration_request_details'].map((n) => `migrations/${n}.sql`),
  ]) {
    await pool.query(fs.readFileSync(path.join(dbDir, file), 'utf8'));
  }
  // Organizers 1 (Hiba, regular), 2 (promoted by mistake), 3 (another mistake), 9 (Sara, Super Admin).
  // Team 10 has Manager 4; team 11 has none.
  await pool.query(`
    INSERT INTO teams (team_id, campus_id, team_name) VALUES (10, 1, 'Tech'), (11, 2, 'Media');
    INSERT INTO users (user_id, full_name, email, role, team_id, clerk_user_id) VALUES
      (1, 'Hiba', 'hiba@x.test', 'Organizer', NULL, 'clerk_1'),
      (2, 'Sami', 'sami@x.test', 'Organizer', NULL, 'clerk_2'),
      (3, 'Rula', 'rula@x.test', 'Organizer', NULL, 'clerk_3'),
      (4, 'Manager T', 'm@x.test', 'Manager', 10, 'clerk_4'),
      (9, 'Sara', 'sara@x.test', 'Organizer', NULL, 'clerk_9');
    UPDATE teams SET manager_user_id = 4 WHERE team_id = 10;
    INSERT INTO assignment_history (user_id, team_id, role_at_time, effective_from) VALUES (4, 10, 'Manager', '2026-01-01');
  `);

  const app = express();
  app.use(express.json());
  app.use('/api/users', usersRoutes);
  app.use((err, _req, res, _next) => { res.status(500).json({ error: { code: 'INTERNAL', message: String(err) } }); });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
    await pool.end();
    if (previousSuperAdmins === undefined) delete process.env.SUPER_ADMIN_CLERK_IDS;
    else process.env.SUPER_ADMIN_CLERK_IDS = previousSuperAdmins;
  });
  const HIBA = 'clerk_1';
  const SUPER = 'clerk_9';
  const call = async (method, route, body, as = SUPER) => {
    currentAuth = { userId: as };
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/users${route}`, {
      method, headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  const one = async (sql, params) => (await pool.query(sql, params)).rows[0];
  const reason = 'Promoted by mistake';
  const restricted = (res) => {
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'ORGANIZER_MANAGEMENT_RESTRICTED');
  };

  await t.test('organizers are listed with their role, status and Super Admin flag', async () => {
    const { status, body } = await call('GET', '/', undefined, HIBA);
    assert.equal(status, 200);
    const organizers = body.data.filter((u) => u.role === 'organizer').map((u) => [u.id, u.isActive, u.isSuperAdmin]);
    assert.deepEqual(organizers, [[1, true, false], [2, true, false], [3, true, false], [9, true, true]]);
  });

  await t.test('a regular Organizer cannot change another Organizer', async () => {
    restricted(await call('PATCH', '/2', { role: 'member', teamId: 11, reason }, HIBA));
    restricted(await call('PATCH', '/2', { name: 'Renamed', reason }, HIBA));
    restricted(await call('PATCH', '/2/status', { isActive: false }, HIBA));
    restricted(await call('DELETE', '/2', { reason }, HIBA));
    restricted(await call('PATCH', '/4', { role: 'organizer', reason }, HIBA));
    assert.deepEqual(await one('SELECT role, full_name, is_active, deleted_at FROM users WHERE user_id = 2'),
      { role: 'Organizer', full_name: 'Sami', is_active: true, deleted_at: null });
    assert.equal((await one('SELECT role FROM users WHERE user_id = 4')).role, 'Manager');
  });

  await t.test('Super Admin demotes an Organizer to Member: team required, history and audit written', async () => {
    const noTeam = await call('PATCH', '/2', { role: 'member', reason });
    assert.equal(noTeam.body.error.code, 'TEAM_REQUIRED');
    const res = await call('PATCH', '/2', { role: 'member', teamId: 11, reason });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(await one('SELECT role, team_id FROM users WHERE user_id = 2'), { role: 'Member', team_id: 11 });
    const history = await one('SELECT team_id, role_at_time, changed_by_user_id, reason, effective_to FROM assignment_history WHERE user_id = 2');
    assert.deepEqual(history, { team_id: 11, role_at_time: 'Member', changed_by_user_id: 9, reason, effective_to: null });
    const audit = await one("SELECT actor_user_id, old_values, new_values, reason FROM audit_logs WHERE action = 'update_user' AND entity_id = '2'");
    assert.equal(audit.actor_user_id, 9);
    assert.equal(audit.old_values.role, 'organizer');
    assert.equal(audit.new_values.role, 'member');
    assert.equal(audit.new_values.teamId, 11);
    assert.equal(audit.new_values.actorIsSuperAdmin, true);
    assert.equal(audit.reason, reason);
  });

  await t.test('Super Admin demotes an Organizer to Manager: only where the manager seat is free', async () => {
    const taken = await call('PATCH', '/3', { role: 'manager', teamId: 10, reason });
    assert.equal(taken.status, 409);
    assert.equal(taken.body.error.code, 'TEAM_MANAGER_EXISTS');
    assert.equal((await one('SELECT role FROM users WHERE user_id = 3')).role, 'Organizer', 'nothing changed');
    const res = await call('PATCH', '/3', { role: 'manager', teamId: 11, reason });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((await one('SELECT manager_user_id FROM teams WHERE team_id = 11')).manager_user_id, 3);
    assert.equal((await one("SELECT role_at_time FROM assignment_history WHERE user_id = 3")).role_at_time, 'Manager');
    assert.ok(await one("SELECT 1 AS ok FROM audit_logs WHERE action = 'update_team_manager' AND entity_id = '11'"));
  });

  await t.test('Super Admin deactivates and reactivates another Organizer', async () => {
    await pool.query("UPDATE users SET role = 'Organizer', team_id = NULL WHERE user_id = 2");
    await pool.query("UPDATE assignment_history SET effective_to = now() WHERE user_id = 2 AND effective_to IS NULL");
    const off = await call('PATCH', '/2/status', { isActive: false });
    assert.equal(off.status, 200, JSON.stringify(off.body));
    assert.equal((await one('SELECT is_active FROM users WHERE user_id = 2')).is_active, false);
    const listed = (await call('GET', '/')).body.data.find((u) => u.id === 2);
    assert.deepEqual([listed.role, listed.isActive], ['organizer', false], 'inactive organizers stay visible');
    assert.equal((await call('PATCH', '/2/status', { isActive: true })).status, 200);
  });

  await t.test('nobody demotes, deactivates or deletes themselves; Super Admin accounts are untouchable', async () => {
    for (const as of [HIBA, SUPER]) {
      const id = as === HIBA ? 1 : 9;
      for (const [method, route, body] of [
        ['PATCH', `/${id}`, { role: 'member', teamId: 11, reason }],
        ['PATCH', `/${id}`, { isActive: false, reason }],
        ['PATCH', `/${id}/status`, { isActive: false }],
        ['DELETE', `/${id}`, { reason }],
      ]) {
        const res = await call(method, route, body, as);
        assert.equal(res.status, 409, `${as} ${method} ${route}`);
        assert.equal(res.body.error.code, 'SELF_LOCKOUT');
      }
    }
    // Organizer accounts (own name included) are edited by a Super Admin only ...
    restricted(await call('PATCH', '/1', { name: 'Hiba A.', reason: 'Spelling' }, HIBA));
    assert.equal((await call('PATCH', '/1', { name: 'Hiba A.', reason: 'Spelling' })).status, 200);
    // ... and a Super Admin account is not edited through the API at all, not even by itself.
    const own = await call('PATCH', '/9', { name: 'Sara B.', reason: 'Spelling' });
    assert.equal(own.status, 403);
    assert.equal(own.body.error.code, 'SUPER_ADMIN_PROTECTED');
    assert.deepEqual(await one('SELECT full_name, role, is_active FROM users WHERE user_id = 9'),
      { full_name: 'Sara', role: 'Organizer', is_active: true });
  });

  await t.test('the last active organizer can never be demoted or deactivated', async () => {
    // Sara deactivates Sami; Rula is a Manager; Sara herself is deactivated outside the API
    // (env-listed accounts are protected from the API), so Hiba is the last active organizer.
    assert.equal((await call('PATCH', '/2/status', { isActive: false })).status, 200);
    await pool.query('UPDATE users SET is_active = FALSE WHERE user_id = 9');
    assert.equal((await one("SELECT COUNT(*)::int AS n FROM users WHERE role = 'Organizer' AND is_active")).n, 1);
    // The data layer refuses on its own as well (defence in depth), even with Super Admin access.
    const SA = { isSuperAdmin: true };
    const repo = require('../src/repositories/users.repository');
    assert.equal((await repo.setUserActiveStatus(1, false, 1, SA)).outcome, 'last_organizer');
    const updates = require('../src/services/update-user.service');
    assert.equal((await updates.updateUser(1, { role: 'member', teamId: 11, reason }, 1, SA)).outcome, 'last_organizer');
    assert.equal((await updates.updateUser(1, { isActive: false, reason }, 1, SA)).outcome, 'last_organizer');
    assert.deepEqual(await one('SELECT role, is_active FROM users WHERE user_id = 1'), { role: 'Organizer', is_active: true });
  });
});
