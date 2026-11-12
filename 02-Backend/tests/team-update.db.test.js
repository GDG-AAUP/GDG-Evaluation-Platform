// Organizer team edit (PATCH /api/teams/:id) against real PostgreSQL in a throwaway schema.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');

const SCHEMA = `team_${process.pid}_${Date.now()}`;

test('organizer edits a team manager', { skip: !process.env.DB_NAME, timeout: 90000 }, async (t) => {
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
  const loadProjectUser = require('../src/middleware/load-project-user');
  const teamsRoutes = require('../src/routes/teams.routes');

  const dbDir = path.join(__dirname, '..', 'db');
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  for (const file of [
    'GDG_evaluation_database.final.postgresql.sql',
    ...['002_user_invitations', '003_user_soft_delete', '004_final_backend_schema',
      '005_manager_evaluation_four_criteria', '006_asia_hebron_timestamps',
      '007_snapshot_rows_per_team_and_campus', '008_enable_remaining_modules',
      '009_registration_approval_flow'].map((name) => `migrations/${name}.sql`),
  ]) {
    await pool.query(fs.readFileSync(path.join(dbDir, file), 'utf8'));
  }
  // Teams: 10 Tech (operational, manager 2), 11 Design (no manager), 12 Media (manager 3),
  // 20 Ramallah Media (no manager), 30/31 (managers 5/6). Every Manager/Member has one open history row.
  await pool.query(`
    INSERT INTO teams (team_id, campus_id, team_name) VALUES
      (10, (SELECT campus_id FROM campuses WHERE campus_name='Jenin'), 'Tech'),
      (11, (SELECT campus_id FROM campuses WHERE campus_name='Jenin'), 'Design'),
      (12, (SELECT campus_id FROM campuses WHERE campus_name='Jenin'), 'Media'),
      (20, (SELECT campus_id FROM campuses WHERE campus_name='Ramallah'), 'Media'),
      (30, (SELECT campus_id FROM campuses WHERE campus_name='Jenin'), 'Events'),
      (31, (SELECT campus_id FROM campuses WHERE campus_name='Jenin'), 'Sport');
    INSERT INTO users (user_id, full_name, email, role, team_id, clerk_user_id) VALUES
      (1, 'Org', 'org@x.test', 'Organizer', NULL, 'clerk_org'),
      (2, 'Mgr Tech', 'm2@x.test', 'Manager', 10, 'clerk_m2'),
      (3, 'Mgr Media', 'm3@x.test', 'Manager', 12, 'clerk_m3'),
      (4, 'Member', 'u4@x.test', 'Member', 10, 'clerk_u4'),
      (5, 'Mgr Events', 'm5@x.test', 'Manager', 30, 'clerk_m5'),
      (6, 'Mgr Sport', 'm6@x.test', 'Manager', 31, 'clerk_m6');
    UPDATE teams SET manager_user_id = CASE team_id WHEN 10 THEN 2 WHEN 12 THEN 3 WHEN 30 THEN 5 WHEN 31 THEN 6 END
      WHERE team_id IN (10, 12, 30, 31);
    UPDATE teams SET is_operational = TRUE WHERE team_id = 10;
    INSERT INTO assignment_history (user_id, team_id, role_at_time, effective_from)
      SELECT user_id, team_id, role, now()::timestamp - INTERVAL '1 day' FROM users WHERE role <> 'Organizer';
  `);

  const app = express();
  app.use(express.json());
  app.use('/api/teams', loadProjectUser, teamsRoutes);
  app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: String(err) }); });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
    await pool.end();
  });

  const patch = async (teamId, body, clerkId = 'clerk_org') => {
    currentAuth = { userId: clerkId };
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/teams/${teamId}`, {
      method: 'PATCH', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const one = async (sql, params) => (await pool.query(sql, params)).rows[0];
  const all = async (sql, params) => (await pool.query(sql, params)).rows;
  const reason = 'نقل المدير';

  await t.test('moves a manager to an empty team in the other campus, with history and audit', async () => {
    const res = await patch(20, { managerId: 3, reason });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.managerId, 3);
    assert.equal(res.body.changed, true);
    assert.deepEqual(await one('SELECT role, team_id FROM users WHERE user_id = 3'), { role: 'Manager', team_id: 20 });
    assert.equal((await one('SELECT manager_user_id FROM teams WHERE team_id = 12')).manager_user_id, null);
    const history = await all(`SELECT team_id, role_at_time, effective_to IS NULL AS open, changed_by_user_id, reason
      FROM assignment_history WHERE user_id = 3 ORDER BY effective_from`);
    assert.deepEqual(history.map((h) => [h.team_id, h.role_at_time, h.open]), [[12, 'Manager', false], [20, 'Manager', true]]);
    assert.equal(history[1].changed_by_user_id, 1);
    assert.equal(history[1].reason, reason);
    const audit = await all(`SELECT action, entity_name, entity_id, old_values, new_values, actor_user_id, reason, created_at
      FROM audit_logs ORDER BY audit_id`);
    const team = audit.find((a) => a.action === 'update_team' && a.entity_id === '20');
    assert.deepEqual(team.old_values, { team_name: 'Media', manager_user_id: null });
    assert.deepEqual(team.new_values, { team_name: 'Media', manager_user_id: 3 });
    assert.equal(team.actor_user_id, 1);
    assert.ok(team.created_at);
    const user = audit.find((a) => a.action === 'update_user' && a.entity_id === '3');
    assert.equal(user.old_values.teamId, 12);
    assert.equal(user.new_values.teamId, 20);
    assert.notEqual(user.old_values.campusId, user.new_values.campusId);
    assert.ok(audit.some((a) => a.action === 'update_team_manager' && a.entity_id === '12' && a.new_values.manager_user_id === null));
  });

  await t.test('rejects a team that already has another manager', async () => {
    const before = await all('SELECT * FROM assignment_history ORDER BY assignment_id');
    const res = await patch(10, { managerId: 5, reason });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'TEAM_MANAGER_EXISTS');
    assert.equal((await one('SELECT manager_user_id FROM teams WHERE team_id = 10')).manager_user_id, 2);
    assert.deepEqual(await all('SELECT * FROM assignment_history ORDER BY assignment_id'), before);
  });

  await t.test('will not leave an operational team without its manager', async () => {
    const moved = await patch(11, { managerId: 2, reason });
    assert.equal(moved.status, 409);
    assert.equal(moved.body.error.code, 'MANAGER_REPLACEMENT_REQUIRED');
    const removed = await patch(10, { managerId: null, reason });
    assert.equal(removed.status, 409);
    assert.equal(removed.body.error.code, 'OPERATIONAL_TEAM_NEEDS_MANAGER');
    assert.deepEqual(await one('SELECT role, team_id FROM users WHERE user_id = 2'), { role: 'Manager', team_id: 10 });
  });

  await t.test('only an active Manager account can be assigned', async () => {
    const res = await patch(11, { managerId: 4, reason });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'INVALID_TEAM_MANAGER');
  });

  await t.test('removing the manager of an inactive team keeps them as a member', async () => {
    const res = await patch(20, { managerId: null, reason });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.managerId, null);
    assert.deepEqual(await one('SELECT role, team_id FROM users WHERE user_id = 3'), { role: 'Member', team_id: 20 });
    const open = await all('SELECT team_id, role_at_time FROM assignment_history WHERE user_id = 3 AND effective_to IS NULL');
    assert.deepEqual(open, [{ team_id: 20, role_at_time: 'Member' }]);
  });

  await t.test('renames a team, refusing a duplicate name in the same campus', async () => {
    const dup = await patch(11, { name: ' tech ', reason });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'TEAM_ALREADY_EXISTS');
    const ok = await patch(11, { name: 'Design Lab', reason });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.name, 'Design Lab');
    const same = await patch(11, { name: 'Design Lab', reason });
    assert.equal(same.body.changed, false);
  });

  await t.test('validates input and requires an organizer', async () => {
    assert.equal((await patch(11, { reason })).body.error.code, 'INVALID_TEAM_DATA');
    assert.equal((await patch(11, { managerId: 5 })).body.error.code, 'INVALID_TEAM_DATA');
    assert.equal((await patch(11, { managerId: '5', reason })).status, 400);
    assert.equal((await patch(11, { managerId: 5, reason, role: 'x' })).status, 400);
    assert.equal((await patch('abc', { managerId: 5, reason })).body.error.code, 'INVALID_TEAM_ID');
    assert.equal((await patch(999, { managerId: 5, reason })).body.error.code, 'TEAM_NOT_FOUND');
    assert.equal((await patch(11, { managerId: 5, reason }, 'clerk_m2')).status, 403);
  });

  await t.test('two concurrent assignments to the same team: exactly one wins', async () => {
    const results = await Promise.all([patch(11, { managerId: 5, reason }), patch(11, { managerId: 6, reason })]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const manager = (await one('SELECT manager_user_id FROM teams WHERE team_id = 11')).manager_user_id;
    assert.ok([5, 6].includes(manager));
    const managersOf11 = await all("SELECT user_id FROM users WHERE role = 'Manager' AND team_id = 11");
    assert.deepEqual(managersOf11.map((u) => u.user_id), [manager]);
  });
});
