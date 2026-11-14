// Full user-management hierarchy and the registration workflow through the real Express app,
// against PostgreSQL (throwaway schema; Clerk and SMTP faked).
// Super Admin: every account except Super Admins. Organizer: Members/Managers of its own campus.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const SCHEMA = `hier_${process.pid}_${Date.now()}`;

test('user management hierarchy and registration approval', { skip: !process.env.DB_NAME, timeout: 120000 }, async (t) => {
  const previousEnv = {
    SUPER_ADMIN_CLERK_IDS: process.env.SUPER_ADMIN_CLERK_IDS,
    CLERK_INVITATION_REDIRECT_URL: process.env.CLERK_INVITATION_REDIRECT_URL,
    APP_LOGIN_URL: process.env.APP_LOGIN_URL,
  };
  process.env.SUPER_ADMIN_CLERK_IDS = 'clerk_super';
  delete process.env.CLERK_INVITATION_REDIRECT_URL; // no Clerk invitation is sent from tests
  process.env.APP_LOGIN_URL = 'https://gdg.example/#/login';
  const pool = new Pool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: `-c search_path=${SCHEMA},public -c timezone=Asia/Hebron`,
  });
  let currentAuth = {};
  const clerkUsers = new Map();
  const replace = (id, exports) => {
    require.cache[require.resolve(id)] = { id, filename: id, loaded: true, exports };
  };
  replace('../src/config/db', pool);
  replace('@clerk/express', {
    clerkMiddleware: () => (_req, _res, next) => next(),
    getAuth: () => currentAuth,
    clerkClient: {
      users: { getUser: async (id) => clerkUsers.get(id) ?? Promise.reject({ status: 404 }), getUserList: async () => ({ data: [] }) },
      invitations: { getInvitationList: async () => ({ data: [] }) },
    },
  });
  const sent = [];
  const mailer = require('../src/services/mailer.service');
  mailer.setTransportForTests({ sendMail: async (message) => { sent.push(message); } });

  const dbDir = path.join(__dirname, '..', 'db');
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  for (const file of [
    'GDG_evaluation_database.final.postgresql.sql',
    ...['002_user_invitations', '003_user_soft_delete', '004_final_backend_schema',
      '005_manager_evaluation_four_criteria', '006_asia_hebron_timestamps',
      '007_snapshot_rows_per_team_and_campus', '008_enable_remaining_modules',
      '009_registration_approval_flow', '010_points_spec_alignment', '011_governance_and_super_admin',
      '012_registration_request_details'].map((n) => `migrations/${n}.sql`),
  ]) {
    await pool.query(fs.readFileSync(path.join(dbDir, file), 'utf8'));
  }
  const campus = async (name) => (await pool.query('SELECT campus_id AS id FROM campuses WHERE campus_name = $1', [name])).rows[0].id;
  const JENIN = await campus('Jenin');
  const RAMALLAH = await campus('Ramallah');
  // Hiba organizes Jenin, Rami Ramallah, Nour has no campus, Sara is the Super Admin.
  // Jenin: Tech (10, Manager J, Member J) and Media (11, no manager). Ramallah: Design (20, Manager R, Member R).
  await pool.query(`
    INSERT INTO teams (team_id, campus_id, team_name) VALUES (10, ${JENIN}, 'Tech'), (11, ${JENIN}, 'Media'), (20, ${RAMALLAH}, 'Design');
    INSERT INTO users (user_id, full_name, email, role, team_id, clerk_user_id, organizer_campus_id) VALUES
      (1, 'Hiba', 'hiba@x.test', 'Organizer', NULL, 'clerk_hiba', ${JENIN}),
      (2, 'Rami', 'rami@x.test', 'Organizer', NULL, 'clerk_rami', ${RAMALLAH}),
      (3, 'Nour', 'nour@x.test', 'Organizer', NULL, 'clerk_nour', NULL),
      (9, 'Sara', 'sara@x.test', 'Organizer', NULL, 'clerk_super', NULL),
      (4, 'Manager J', 'mj@x.test', 'Manager', 10, 'clerk_mj', NULL),
      (5, 'Member J', 'uj@x.test', 'Member', 10, 'clerk_uj', NULL),
      (6, 'Manager R', 'mr@x.test', 'Manager', 20, 'clerk_mr', NULL),
      (7, 'Member R', 'ur@x.test', 'Member', 20, 'clerk_ur', NULL);
    UPDATE teams SET manager_user_id = CASE team_id WHEN 10 THEN 4 WHEN 20 THEN 6 END, is_operational = team_id <> 11;
    INSERT INTO assignment_history (user_id, team_id, role_at_time, effective_from)
      SELECT user_id, team_id, role, '2026-01-01' FROM users WHERE role <> 'Organizer';
    SELECT setval(pg_get_serial_sequence('users', 'user_id'), 100);
  `);

  const app = require('../src/app');
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(async () => {
    mailer.setTransportForTests(null);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await pool.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
    await pool.end();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  const HIBA = 'clerk_hiba';
  const RAMI = 'clerk_rami';
  const NOUR = 'clerk_nour';
  const SUPER = 'clerk_super';
  const call = async (as, method, url, body) => {
    currentAuth = as ? { userId: as } : {};
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api${url}`, {
      method, headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const one = async (sql, params) => (await pool.query(sql, params)).rows[0];
  const refused = (res, code) => {
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.error.code, code);
  };
  const reason = 'Hierarchy test';

  await t.test('every Organizer reads all users (both campuses), with the Super Admin flag', async () => {
    for (const as of [HIBA, RAMI, SUPER]) {
      const res = await call(as, 'GET', '/users');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.data.map((u) => u.id).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 9]);
    }
    const list = (await call(HIBA, 'GET', '/users')).body.data;
    assert.equal(list.find((u) => u.id === 9).isSuperAdmin, true);
    assert.equal(list.find((u) => u.id === 1).campusId, JENIN);
  });

  await t.test('a campus Organizer manages Members and Managers of its own campus', async () => {
    assert.equal((await call(HIBA, 'PATCH', '/users/5', { name: 'Member J.', reason })).status, 200);
    const moved = await call(HIBA, 'PATCH', '/users/5', { teamId: 11, reason: 'Transfer inside Jenin' });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal((await call(HIBA, 'PATCH', '/users/5/status', { isActive: false })).status, 200);
    assert.equal((await call(HIBA, 'PATCH', '/users/5/status', { isActive: true })).status, 200);
    assert.equal((await one('SELECT team_id FROM users WHERE user_id = 5')).team_id, 11);
  });

  await t.test('a campus Organizer gets 403 for Organizers, Super Admins and the other campus', async () => {
    refused(await call(HIBA, 'PATCH', '/users/7', { name: 'Other campus', reason }), 'OUT_OF_CAMPUS_SCOPE');
    refused(await call(HIBA, 'PATCH', '/users/6/status', { isActive: false }), 'OUT_OF_CAMPUS_SCOPE');
    refused(await call(HIBA, 'DELETE', '/users/7', { reason }), 'OUT_OF_CAMPUS_SCOPE');
    refused(await call(HIBA, 'PATCH', '/users/5', { teamId: 20, reason: 'Move to Ramallah' }), 'OUT_OF_CAMPUS_SCOPE');
    refused(await call(HIBA, 'PATCH', '/users/2', { name: 'Rami K.', reason }), 'ORGANIZER_MANAGEMENT_RESTRICTED');
    refused(await call(HIBA, 'DELETE', '/users/2', { reason }), 'ORGANIZER_MANAGEMENT_RESTRICTED');
    refused(await call(HIBA, 'PATCH', '/users/4', { role: 'organizer', reason }), 'ORGANIZER_MANAGEMENT_RESTRICTED');
    refused(await call(HIBA, 'PATCH', '/users/9', { name: 'Sara B.', reason }), 'SUPER_ADMIN_PROTECTED');
    refused(await call(RAMI, 'PATCH', '/users/5', { name: 'Not mine', reason }), 'OUT_OF_CAMPUS_SCOPE');
    refused(await call(NOUR, 'PATCH', '/users/5', { name: 'No campus', reason }), 'ORGANIZER_CAMPUS_REQUIRED');
    assert.deepEqual(await one('SELECT full_name, team_id, is_active, deleted_at FROM users WHERE user_id = 7'),
      { full_name: 'Member R', team_id: 20, is_active: true, deleted_at: null });
    assert.deepEqual(await one('SELECT full_name, role FROM users WHERE user_id = 2'), { full_name: 'Rami', role: 'Organizer' });
  });

  await t.test('manual account creation (POST /api/users) is disabled for everyone', async () => {
    for (const [as, body] of [
      [HIBA, { name: 'New J', email: 'newj@x.test', role: 'member', teamId: 10 }],
      [SUPER, { name: 'New Organizer', email: 'neworg@x.test', role: 'organizer', campusId: RAMALLAH }],
    ]) {
      const res = await call(as, 'POST', '/users', body);
      assert.equal(res.status, 405);
      assert.equal(res.body.error.code, 'MANUAL_CREATION_DISABLED');
      assert.match(res.body.error.message, /users must sign up and submit a registration request/);
    }
    assert.equal((await one("SELECT COUNT(*)::int AS n FROM users WHERE email IN ('newj@x.test', 'neworg@x.test')")).n, 0);
    // An Organizer account to work with below, created the only way there is: an approved request.
    await pool.query(`INSERT INTO users (user_id, full_name, email, role, clerk_user_id, organizer_campus_id)
      VALUES (50, 'New Organizer', 'neworg@x.test', 'Organizer', 'clerk_neworg', ${RAMALLAH})`);
  });

  await t.test('the Super Admin manages every other account on both campuses', async () => {
    assert.equal((await call(SUPER, 'PATCH', '/users/2', { name: 'Rami K.', reason })).status, 200);
    assert.equal((await call(SUPER, 'PATCH', '/users/2', { campusId: JENIN, reason: 'Moved campus' })).status, 200);
    assert.equal((await one('SELECT organizer_campus_id FROM users WHERE user_id = 2')).organizer_campus_id, JENIN);
    assert.equal((await call(SUPER, 'PATCH', '/users/6', { name: 'Manager R.', reason })).status, 200);
    assert.equal((await call(SUPER, 'PATCH', '/users/7', { teamId: 11, reason: 'Cross-campus transfer' })).status, 200);
    assert.equal((await one('SELECT team_id FROM users WHERE user_id = 7')).team_id, 11);
    assert.equal((await call(SUPER, 'PATCH', '/users/50/status', { isActive: false })).status, 200);
    assert.equal((await call(SUPER, 'PATCH', '/users/50/status', { isActive: true })).status, 200);
    // A Manager of an operational team is deleted only after a replacement (unchanged business rule).
    assert.equal((await call(SUPER, 'DELETE', '/users/6', { reason })).body.error.code, 'MANAGER_REPLACEMENT_REQUIRED');
    await pool.query('UPDATE teams SET is_operational = FALSE WHERE team_id = 20');
    assert.equal((await call(SUPER, 'DELETE', '/users/6', { reason })).status, 200);
    // Super Admin accounts: never downgraded, deactivated or deleted through the API.
    await pool.query("UPDATE users SET role = 'Organizer' WHERE user_id = 9");
    refused(await call(SUPER, 'PATCH', '/users/9', { name: 'Sara B.', reason }), 'SUPER_ADMIN_PROTECTED');
    assert.equal((await call(SUPER, 'DELETE', '/users/9', { reason })).body.error.code, 'SELF_LOCKOUT');
  });

  await t.test('restore & reassign: a former Manager whose team has a new Manager is refused (409) unless reassigned', async () => {
    // Manager J leaves Tech (10) and is soft-deleted; Bob then becomes Tech's Manager.
    await pool.query('UPDATE teams SET is_operational = FALSE WHERE team_id = 10');
    assert.equal((await call(SUPER, 'DELETE', '/users/4', { reason })).status, 200);
    assert.equal((await one('SELECT manager_user_id FROM teams WHERE team_id = 10')).manager_user_id, null);
    await pool.query(`INSERT INTO users (user_id, full_name, email, role, team_id, clerk_user_id) VALUES (60, 'Bob', 'bob@x.test', 'Manager', 10, 'clerk_bob');
      UPDATE teams SET manager_user_id = 60 WHERE team_id = 10;
      INSERT INTO assignment_history (user_id, team_id, role_at_time, effective_from) VALUES (60, 10, 'Manager', now())`);

    const restore = (as, body, id = 4) => call(as, 'POST', `/users/${id}/restore`, { reason: 'Back from leave', ...body });
    // Campus scope: the other campus's Organizer, an Organizer without a campus, a restore into the
    // other campus and the Organizer role are refused before anything changes.
    refused(await restore(RAMI, { role: 'member', campusId: RAMALLAH, teamId: 20 }), 'OUT_OF_CAMPUS_SCOPE');
    refused(await restore(NOUR, { role: 'member', campusId: JENIN, teamId: 10 }), 'ORGANIZER_CAMPUS_REQUIRED');
    refused(await restore(HIBA, { role: 'member', campusId: RAMALLAH, teamId: 20 }), 'OUT_OF_CAMPUS_SCOPE');
    refused(await restore(HIBA, { role: 'organizer', campusId: JENIN }), 'SUPER_ADMIN_REQUIRED');
    for (const body of [{ role: 'manager', campusId: JENIN }, { role: 'member', campusId: JENIN }, { role: 'organizer', campusId: JENIN, teamId: 10 },
      { role: 'admin', campusId: JENIN, teamId: 10 }, { role: 'member', teamId: 10 }]) {
      const res = await restore(SUPER, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error.code, 'INVALID_RESTORE_DATA');
    }
    const mismatch = await restore(SUPER, { role: 'member', campusId: RAMALLAH, teamId: 10 });
    assert.equal(mismatch.body.error.code, 'TEAM_CAMPUS_MISMATCH');

    for (const as of [SUPER, HIBA]) {
      const taken = await restore(as, { role: 'manager', campusId: JENIN, teamId: 10 });
      assert.equal(taken.status, 409);
      assert.equal(taken.body.error.code, 'RESTORE_TEAM_MANAGER_EXISTS');
    }
    assert.ok((await one('SELECT deleted_at FROM users WHERE user_id = 4')).deleted_at, 'still deleted');
    assert.equal((await one('SELECT manager_user_id FROM teams WHERE team_id = 10')).manager_user_id, 60, 'the current manager keeps the seat');

    // The Jenin Organizer reassigns them as a Member of the same team: restored, active, and the
    // history and audit record both assignments.
    const member = await restore(HIBA, { role: 'member', campusId: JENIN, teamId: 10 });
    assert.equal(member.status, 200, JSON.stringify(member.body));
    assert.deepEqual(await one('SELECT role, team_id, is_active, deleted_at FROM users WHERE user_id = 4'),
      { role: 'Member', team_id: 10, is_active: true, deleted_at: null });
    assert.equal((await one('SELECT COUNT(*)::int AS n FROM assignment_history WHERE user_id = 4 AND effective_to IS NULL')).n, 1);
    const audit = await one("SELECT actor_user_id, old_values, new_values FROM audit_logs WHERE action = 'restore_user' AND entity_id = '4'");
    assert.equal(audit.actor_user_id, 1);
    assert.deepEqual([audit.old_values.role, audit.old_values.teamId, audit.old_values.deletedAt !== null], ['manager', 10, true]);
    assert.deepEqual([audit.new_values.role, audit.new_values.teamId, audit.new_values.isActive, audit.new_values.actorIsSuperAdmin],
      ['member', 10, true, undefined]);
    assert.equal((await restore(SUPER, { role: 'member', campusId: JENIN, teamId: 10 })).body.error.code, 'USER_NOT_DELETED');
  });

  await t.test('restore & reassign: a vacant team takes the restored Manager; Organizers only as Super Admin choice', async () => {
    // Manager R (6) was deleted earlier from Design (20); Design's seat is vacant, so 6 returns as its Manager.
    const vacant = await call(SUPER, 'PATCH', '/users/6/restore', { role: 'manager', campusId: RAMALLAH, teamId: 20, reason: 'Vacant seat' });
    assert.equal(vacant.status, 200, JSON.stringify(vacant.body));
    assert.equal((await one('SELECT manager_user_id FROM teams WHERE team_id = 20')).manager_user_id, 6);
    assert.deepEqual(await one('SELECT role, team_id, is_active FROM users WHERE user_id = 6'), { role: 'Manager', team_id: 20, is_active: true });
    // A deleted Organizer comes back as an Organizer with the confirmed campus (no team);
    // former Organizer accounts are a Super Admin matter, so a campus Organizer is refused.
    assert.equal((await call(SUPER, 'DELETE', '/users/50', { reason })).status, 200);
    await pool.query(`UPDATE users SET organizer_campus_id = ${JENIN} WHERE user_id = 2`);
    refused(await call(RAMI, 'POST', '/users/50/restore', { role: 'member', campusId: JENIN, teamId: 11, reason: 'x' }), 'ORGANIZER_MANAGEMENT_RESTRICTED');
    const organizer = await call(SUPER, 'POST', '/users/50/restore', { role: 'organizer', campusId: JENIN, reason: 'Rejoined' });
    assert.equal(organizer.status, 200, JSON.stringify(organizer.body));
    assert.deepEqual(await one('SELECT role, team_id, organizer_campus_id, is_active FROM users WHERE user_id = 50'),
      { role: 'Organizer', team_id: null, organizer_campus_id: JENIN, is_active: true });
    refused(await call(SUPER, 'POST', '/users/9/restore', { role: 'member', campusId: JENIN, teamId: 10, reason: 'x' }), 'SUPER_ADMIN_PROTECTED');
  });

  await t.test('team changes follow the campus scope (no bypass through team endpoints)', async () => {
    const team = (as, id, body, method = 'PATCH', path = '') =>
      call(as, method, `/teams/${id}${path}`, body);
    await pool.query(`UPDATE users SET organizer_campus_id = ${RAMALLAH} WHERE user_id = 2`);
    // Hiba (Jenin) cannot rename, re-manage or switch on a Ramallah team, nor create one there.
    refused(await team(HIBA, 20, { name: 'Design X', reason }), 'OUT_OF_CAMPUS_SCOPE');
    refused(await team(HIBA, 20, { isOperational: false }, 'PATCH', '/status'), 'OUT_OF_CAMPUS_SCOPE');
    refused(await team(HIBA, 20, { managerId: 7, expectedManagerId: 6, reason }, 'PATCH', '/manager'), 'OUT_OF_CAMPUS_SCOPE');
    refused(await call(HIBA, 'POST', '/teams', { name: 'New R', campusId: RAMALLAH }), 'OUT_OF_CAMPUS_SCOPE');
    // ... nor pull a Ramallah person into a Jenin team as its manager.
    refused(await team(HIBA, 11, { managerId: 6, reason }), 'OUT_OF_CAMPUS_SCOPE');
    refused(await team(NOUR, 11, { name: 'No campus', reason }), 'ORGANIZER_CAMPUS_REQUIRED');
    assert.equal((await one('SELECT team_name FROM teams WHERE team_id = 20')).team_name, 'Design');
    // Inside its campus it works; the Super Admin works on both campuses.
    assert.equal((await call(HIBA, 'POST', '/teams', { name: 'New J', campusId: JENIN })).status, 201);
    assert.equal((await team(SUPER, 20, { name: 'Design R', reason })).status, 200);
    assert.equal((await team(SUPER, 20, { name: 'Design', reason })).status, 200);
  });

  await t.test('monthly leaderboard: every role sees both campuses, each campus, and teams, with dense ranks', async () => {
    const month = await one(`SELECT EXTRACT(YEAR FROM now() AT TIME ZONE 'Asia/Hebron')::int AS y,
      EXTRACT(MONTH FROM now() AT TIME ZONE 'Asia/Hebron')::int AS m`);
    const add = (userId, points) => pool.query(
      `INSERT INTO point_entries (user_id, performed_by_user_id, points, activity_name, reason) VALUES ($1, 9, $2, 'QA', 'QA')`, [userId, points]);
    await add(5, 10); await add(7, 10); await add(60, 4);
    const board = async (as, query) => call(as, 'GET', `/rankings?year=${month.y}&month=${month.m}&${query}`);
    for (const as of ['clerk_uj', 'clerk_mj', HIBA, SUPER]) {
      const all = await board(as, 'campus=all');
      assert.equal(all.status, 200, `${as}: ${JSON.stringify(all.body)}`);
    }
    const all = (await board('clerk_uj', 'campus=all')).body.data;
    const top = all.filter((r) => r.rank === 1).map((r) => [r.fullName, r.campusName]).sort();
    assert.deepEqual(top, [['Member J.', 'Jenin'], ['Member R', 'Jenin']], 'a tie shares rank 1 (Member R now sits in a Jenin team)');
    assert.equal(all.find((r) => r.fullName === 'Bob').rank, 2, 'dense: 1, 1, 2');
    assert.ok(all.every((r) => r.campusName), 'every row carries its campus');
    const jenin = (await board('clerk_uj', 'campus=jenin')).body.data;
    assert.ok(jenin.length > 0 && jenin.every((r) => r.userId !== undefined));
    assert.equal((await board('clerk_uj', 'scope=all')).status, 200);
    assert.equal((await board('clerk_uj', 'campus=gaza')).status, 400);
    assert.equal((await board('clerk_uj', 'scope=all&campusId=1')).status, 400);
  });

  await t.test('registration: request -> notifications for every Organizer -> approval / rejection emails and audits', async () => {
    clerkUsers.set('clerk_new', {
      firstName: 'Layan', lastName: 'Saleh', primaryEmailAddressId: 'e1',
      emailAddresses: [{ id: 'e1', emailAddress: 'layan@x.test', verification: { status: 'verified' } }],
    });
    assert.equal((await call('clerk_new', 'GET', '/auth/me')).body.error.code, 'REGISTRATION_REQUIRED');
    const asked = await call('clerk_new', 'POST', '/registrations/request', { fullName: 'Layan Saleh', role: 'member', campusId: JENIN, teamId: 10 });
    assert.equal(asked.status, 201, JSON.stringify(asked.body));
    assert.equal((await call('clerk_new', 'GET', '/auth/me')).body.error.code, 'REGISTRATION_PENDING');

    const count = async (as) => (await call(as, 'GET', '/auth/me')).body.data.pendingRegistrationsCount;
    assert.deepEqual([await count(SUPER), await count(HIBA), await count(RAMI), await count(NOUR)], [1, 1, 1, 1],
      'every Organizer is notified, whatever its campus');
    assert.equal((await call('clerk_mj', 'GET', '/auth/me')).body.data.pendingRegistrationsCount, null, 'not for Managers');
    const pending = await call(HIBA, 'GET', '/registrations/pending');
    assert.deepEqual(pending.body.data.map((r) => [r.email, r.requestedRole, r.requestedCampusName, r.requestedTeamName]),
      [['layan@x.test', 'member', 'Jenin', 'Tech']]);

    const id = pending.body.data[0].id;
    // The Ramallah Organizer may decide this Jenin request too (cross-campus approval).
    const approved = await call(RAMI, 'POST', `/registrations/${id}/approve`, { role: 'member', campusId: JENIN, teamId: 11 });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.data.emailStatus, 'sent');
    assert.deepEqual(await one("SELECT full_name, role, team_id, is_active, clerk_user_id FROM users WHERE email = 'layan@x.test'"),
      { full_name: 'Layan Saleh', role: 'Member', team_id: 11, is_active: true, clerk_user_id: 'clerk_new' });
    const mail = sent.at(-1);
    assert.equal(mail.to, 'layan@x.test');
    assert.match(mail.text, /بدور عضو في فريق Media - فرع جنين/);
    assert.match(mail.text, /https:\/\/gdg\.example\/#\/login/);
    assert.match(mail.html, /عضو \(Member\)/);
    assert.match(mail.html, /جنين \(Jenin\)/);
    assert.match(mail.html, /<b>Media<\/b>/);
    const audit = await one("SELECT actor_user_id, new_values FROM audit_logs WHERE action = 'approve_registration'");
    assert.equal(audit.actor_user_id, 2);
    assert.equal(audit.new_values.team_id, 11);
    const me = await call('clerk_new', 'GET', '/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.data.role, 'member');
    assert.equal(await count(HIBA), 0, 'the badge goes back down');

    // Rejection: a second applicant, refused with a reason -> email with the reason, audit, count 0.
    clerkUsers.set('clerk_no', {
      firstName: 'Ziad', primaryEmailAddressId: 'e1',
      emailAddresses: [{ id: 'e1', emailAddress: 'ziad@x.test', verification: { status: 'verified' } }],
    });
    assert.equal((await call('clerk_no', 'POST', '/registrations/request', { role: 'manager', campusId: RAMALLAH })).status, 201);
    assert.equal(await count(HIBA), 1);
    const ziad = (await call(HIBA, 'GET', '/registrations/pending')).body.data[0].id;
    const rejected = await call(HIBA, 'POST', `/registrations/${ziad}/reject`, { reason: 'Team is full this semester' });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.data.emailStatus, 'sent');
    assert.equal(sent.at(-1).to, 'ziad@x.test');
    assert.match(sent.at(-1).text, /السبب: Team is full this semester/);
    assert.match(sent.at(-1).html, /Team is full this semester/);
    assert.ok(await one("SELECT 1 AS ok FROM audit_logs WHERE action = 'reject_registration' AND actor_user_id = 1"));
    assert.equal(await count(RAMI), 0);
    assert.equal((await call('clerk_no', 'GET', '/auth/me')).body.error.code, 'REGISTRATION_REJECTED');
  });
});
