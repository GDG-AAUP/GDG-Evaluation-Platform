// Super Admin governance through the real Express app against PostgreSQL (throwaway schema; Clerk faked):
// Organizer account protection, evaluation target rules, campus isolation with delegation flags,
// and the governance settings API with its audit trail.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const SCHEMA = `gov_${process.pid}_${Date.now()}`;

test('Super Admin governance', { skip: !process.env.DB_NAME, timeout: 120000 }, async (t) => {
  const previousSuperAdmins = process.env.SUPER_ADMIN_CLERK_IDS;
  process.env.SUPER_ADMIN_CLERK_IDS = 'clerk_super, clerk_other_super';
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
    clerkMiddleware: () => (_req, _res, next) => next(),
    getAuth: () => currentAuth,
    clerkClient: { users: { getUser: async () => Promise.reject({ status: 404 }) },
      invitations: { getInvitationList: async () => ({ data: [] }) } },
  });

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
  const campus = async (name) => (await pool.query('SELECT campus_id AS id FROM campuses WHERE campus_name = $1', [name])).rows[0].id;
  const JENIN = await campus('Jenin');
  const RAMALLAH = await campus('Ramallah');
  // Hiba organizes in Jenin, Rami in Ramallah, Nour has no campus yet, Sara is a Super Admin.
  // Tech (Jenin): Manager J + Member J. Design (Ramallah): Manager R + Member R.
  await pool.query(`
    INSERT INTO teams (team_id, campus_id, team_name) VALUES (10, ${JENIN}, 'Tech'), (20, ${RAMALLAH}, 'Design');
    INSERT INTO users (user_id, full_name, email, role, team_id, clerk_user_id, organizer_campus_id) VALUES
      (1, 'Hiba', 'hiba@x.test', 'Organizer', NULL, 'clerk_hiba', ${JENIN}),
      (2, 'Rami', 'rami@x.test', 'Organizer', NULL, 'clerk_rami', ${RAMALLAH}),
      (3, 'Nour', 'nour@x.test', 'Organizer', NULL, 'clerk_nour', NULL),
      (9, 'Sara', 'sara@x.test', 'Organizer', NULL, 'clerk_super', NULL),
      (4, 'Manager J', 'mj@x.test', 'Manager', 10, 'clerk_mj', NULL),
      (5, 'Member J', 'uj@x.test', 'Member', 10, 'clerk_uj', NULL),
      (6, 'Manager R', 'mr@x.test', 'Manager', 20, 'clerk_mr', NULL),
      (7, 'Member R', 'ur@x.test', 'Member', 20, 'clerk_ur', NULL);
    UPDATE teams SET manager_user_id = CASE team_id WHEN 10 THEN 4 ELSE 6 END, is_operational = TRUE;
    INSERT INTO assignment_history (user_id, team_id, role_at_time, effective_from)
      SELECT user_id, team_id, role, '2026-01-01' FROM users WHERE role <> 'Organizer';
  `);

  const app = require('../src/app');
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await pool.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
    await pool.end();
    if (previousSuperAdmins === undefined) delete process.env.SUPER_ADMIN_CLERK_IDS;
    else process.env.SUPER_ADMIN_CLERK_IDS = previousSuperAdmins;
  });

  const HIBA = 'clerk_hiba';
  const RAMI = 'clerk_rami';
  const NOUR = 'clerk_nour';
  const SUPER = 'clerk_super';
  const call = async (as, method, url, body) => {
    currentAuth = { userId: as };
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
  const evaluate = (as, evaluatedUserId) => call(as, 'POST', '/evaluations/managers', {
    evaluatedUserId, activityName: 'Monthly review', activityDate: '2026-10-01',
    criteriaScores: [80, 80, 80, 80], comments: null,
  });
  const SCORES = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`cat${i + 1}`, i < 5 ? 8 : 4]));
  const rate = (as, userId) => call(as, 'POST', '/ratings', { userId, scores: SCORES, reason: 'Monthly rating' });
  const targets = async (as) => (await call(as, 'GET', '/ratings/targets')).body.data.map((p) => Number(p.id)).sort();
  const setFlags = (as, flags) => call(as, 'PATCH', '/governance/settings', { ...flags, reason: 'Emergency delegation' });

  await t.test('/api/auth/me exposes isSuperAdmin, the organizer campus and the governance flags', async () => {
    const sara = (await call(SUPER, 'GET', '/auth/me')).body.data;
    assert.equal(sara.isSuperAdmin, true);
    assert.deepEqual(
      [sara.governance.allowOrganizerMemberEval, sara.governance.allowJeninEvalRamallah, sara.governance.allowRamallahEvalJenin],
      [false, false, false]);
    const hiba = (await call(HIBA, 'GET', '/auth/me')).body.data;
    assert.equal(hiba.isSuperAdmin, false);
    assert.equal(hiba.campusId, JENIN);
    const manager = (await call('clerk_mj', 'GET', '/auth/me')).body.data;
    assert.equal(manager.isSuperAdmin, false);
    assert.equal(manager.governance, null, 'only organizers receive the governance flags');
  });

  await t.test('governance settings: every Organizer reads, only a Super Admin writes', async () => {
    const read = await call(HIBA, 'GET', '/governance/settings');
    assert.equal(read.status, 200);
    assert.equal(read.body.data.allowOrganizerMemberEval, false);
    assert.equal(read.body.data.canEdit, false);
    assert.equal((await call(SUPER, 'GET', '/governance/settings')).body.data.canEdit, true);
    assert.equal((await call('clerk_mj', 'GET', '/governance/settings')).status, 403, 'managers cannot read them');
    refused(await setFlags(HIBA, { allowOrganizerMemberEval: true }), 'SUPER_ADMIN_REQUIRED');
    for (const body of [{}, { allowOrganizerMemberEval: 'yes' }, { somethingElse: true }]) {
      const res = await call(SUPER, 'PATCH', '/governance/settings', body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error.code, 'INVALID_GOVERNANCE_DATA');
    }
    assert.equal((await one('SELECT allow_organizer_member_eval AS v FROM governance_settings')).v, false);
  });

  await t.test('a regular Organizer cannot create, edit, deactivate or delete Organizer accounts', async () => {
    refused(await call(HIBA, 'PATCH', '/users/2', { name: 'Rami K.', reason: 'Spelling' }), 'ORGANIZER_MANAGEMENT_RESTRICTED');
    refused(await call(HIBA, 'PATCH', '/users/2', { role: 'member', teamId: 10, reason: 'Demote' }), 'ORGANIZER_MANAGEMENT_RESTRICTED');
    refused(await call(HIBA, 'PATCH', '/users/3', { campusId: JENIN, reason: 'Campus' }), 'ORGANIZER_MANAGEMENT_RESTRICTED');
    refused(await call(HIBA, 'PATCH', '/users/2/status', { isActive: false }), 'ORGANIZER_MANAGEMENT_RESTRICTED');
    refused(await call(HIBA, 'DELETE', '/users/2', { reason: 'Remove' }), 'ORGANIZER_MANAGEMENT_RESTRICTED');
    refused(await call(HIBA, 'PATCH', '/users/5', { role: 'organizer', reason: 'Promote' }), 'ORGANIZER_MANAGEMENT_RESTRICTED');
    for (const as of [HIBA, SUPER]) {
      refused(await call(as, 'PATCH', '/users/9', { name: 'Sara B.', reason: 'Edit' }), 'SUPER_ADMIN_PROTECTED');
    }
    refused(await call(HIBA, 'PATCH', '/users/9/status', { isActive: false }), 'SUPER_ADMIN_PROTECTED');
    refused(await call(HIBA, 'DELETE', '/users/9', { reason: 'Remove' }), 'SUPER_ADMIN_PROTECTED');
    assert.deepEqual(await one('SELECT full_name, role, is_active, deleted_at FROM users WHERE user_id = 2'),
      { full_name: 'Rami', role: 'Organizer', is_active: true, deleted_at: null });
    assert.equal((await one('SELECT role FROM users WHERE user_id = 5')).role, 'Member');
    // Members and Managers are still managed by any Organizer.
    assert.equal((await call(HIBA, 'PATCH', '/users/5', { name: 'Member J.', reason: 'Spelling' })).status, 200);
  });

  await t.test('a Super Admin manages Organizer accounts (campus, role, status), audited', async () => {
    const campusSet = await call(SUPER, 'PATCH', '/users/3', { campusId: JENIN, reason: 'Assign campus' });
    assert.equal(campusSet.status, 200, JSON.stringify(campusSet.body));
    assert.equal(campusSet.body.data.campusId, JENIN);
    const bad = await call(SUPER, 'PATCH', '/users/5', { campusId: JENIN, reason: 'Members take the team campus' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'INVALID_ASSIGNMENT');
    assert.equal((await call(SUPER, 'PATCH', '/users/2', { name: 'Rami K.', reason: 'Spelling' })).status, 200);
    assert.equal((await call(SUPER, 'PATCH', '/users/2/status', { isActive: false })).status, 200);
    assert.equal((await call(SUPER, 'PATCH', '/users/2/status', { isActive: true })).status, 200);
    const promoted = await call(SUPER, 'PATCH', '/users/7', { role: 'organizer', campusId: RAMALLAH, reason: 'New organizer' });
    assert.equal(promoted.status, 200, JSON.stringify(promoted.body));
    assert.deepEqual(await one('SELECT role, team_id, organizer_campus_id FROM users WHERE user_id = 7'),
      { role: 'Organizer', team_id: null, organizer_campus_id: RAMALLAH });
    const demoted = await call(SUPER, 'PATCH', '/users/7', { role: 'member', teamId: 20, reason: 'Back to member' });
    assert.equal(demoted.status, 200, JSON.stringify(demoted.body));
    assert.deepEqual(await one('SELECT role, team_id, organizer_campus_id FROM users WHERE user_id = 7'),
      { role: 'Member', team_id: 20, organizer_campus_id: null }, 'the organizer campus is cleared on demotion');
    const audit = await one("SELECT actor_user_id, new_values FROM audit_logs WHERE action = 'update_user' AND entity_id = '3'");
    assert.equal(audit.actor_user_id, 9);
    assert.equal(audit.new_values.campusId, JENIN);
    assert.equal(audit.new_values.actorIsSuperAdmin, true);
  });

  await t.test('nobody evaluates an Organizer or a Super Admin', async () => {
    for (const as of [HIBA, SUPER]) {
      refused(await evaluate(as, 2), 'EVALUATION_TARGET_ORGANIZER');
      refused(await evaluate(as, 9), 'EVALUATION_TARGET_ORGANIZER');
    }
    refused(await rate(HIBA, 2), 'EVALUATION_TARGET_ORGANIZER');
    assert.equal((await one('SELECT count(*)::int AS n FROM performance_evaluations')).n, 0);
  });

  await t.test('defaults: an Organizer evaluates Managers of its own campus only', async () => {
    assert.equal((await evaluate(HIBA, 4)).status, 201, 'Jenin organizer -> Jenin manager');
    refused(await evaluate(HIBA, 5), 'ORGANIZER_MEMBER_EVAL_DISABLED');
    refused(await rate(HIBA, 5), 'ORGANIZER_MEMBER_EVAL_DISABLED');
    refused(await evaluate(HIBA, 6), 'CROSS_CAMPUS_EVAL_DISABLED');
    refused(await rate(HIBA, 6), 'CROSS_CAMPUS_EVAL_DISABLED');
    refused(await evaluate(RAMI, 4), 'CROSS_CAMPUS_EVAL_DISABLED');
    assert.equal((await evaluate(RAMI, 6)).status, 201, 'Ramallah organizer -> Ramallah manager');
    assert.deepEqual(await targets(HIBA), [4], 'the rating list offers only what the server accepts');
    await pool.query('UPDATE users SET organizer_campus_id = NULL WHERE user_id = 3');
    refused(await evaluate(NOUR, 4), 'ORGANIZER_CAMPUS_REQUIRED');
    await pool.query(`UPDATE users SET organizer_campus_id = ${JENIN} WHERE user_id = 3`);
  });

  await t.test('a Super Admin evaluates Managers and Members on both campuses, audited as such', async () => {
    assert.equal((await evaluate(SUPER, 5)).status, 201);
    assert.equal((await evaluate(SUPER, 7)).status, 201);
    assert.equal((await evaluate(SUPER, 6)).status, 201);
    assert.equal((await rate(SUPER, 7)).status, 201);
    assert.deepEqual(await targets(SUPER), [4, 5, 6, 7]);
    const audits = (await pool.query(
      "SELECT reason, new_values FROM audit_logs WHERE action = 'PERFORMANCE_EVALUATION_CREATED' AND actor_user_id = 9")).rows;
    assert.equal(audits.length, 3);
    assert.ok(audits.every((a) => a.new_values.actorIsSuperAdmin === true && /\[Super Admin\]$/.test(a.reason)));
    assert.ok(audits.some((a) => a.new_values.evaluatedRole === 'member' && /^Member evaluation/.test(a.reason)));
    const scorecard = await one("SELECT new_values FROM audit_logs WHERE action = 'SAVE_SCORECARD' AND actor_user_id = 9");
    assert.equal(scorecard.new_values.actorIsSuperAdmin, true);
    const average = await call(SUPER, 'GET', '/evaluations/managers/5/average?year=2026&month=10');
    assert.equal(average.status, 200, 'a Member\'s evaluations have a monthly average too');
    assert.equal(average.body.data.evaluationCount, 1);
  });

  await t.test('allow_organizer_member_eval lets Organizers evaluate Members of their campus', async () => {
    const res = await setFlags(SUPER, { allowOrganizerMemberEval: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.changed, true);
    assert.equal(res.body.data.allowOrganizerMemberEval, true);
    assert.equal(res.body.data.updatedBy, SUPER);
    assert.equal((await evaluate(HIBA, 5)).status, 201);
    assert.equal((await rate(HIBA, 5)).status, 201);
    refused(await evaluate(HIBA, 7), 'CROSS_CAMPUS_EVAL_DISABLED');
    assert.deepEqual(await targets(HIBA), [4, 5]);
    const audit = await one("SELECT actor_user_id, old_values, new_values, reason FROM audit_logs WHERE action = 'GOVERNANCE_SETTINGS_UPDATED'");
    assert.equal(audit.actor_user_id, 9);
    assert.equal(audit.old_values.allowOrganizerMemberEval, false);
    assert.equal(audit.new_values.allowOrganizerMemberEval, true);
    assert.equal(audit.new_values.updatedBy, SUPER);
    assert.ok(audit.new_values.updatedAt);
    assert.equal(audit.reason, 'Emergency delegation');
    const again = await setFlags(SUPER, { allowOrganizerMemberEval: true });
    assert.equal(again.body.changed, false);
    assert.equal((await one("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'GOVERNANCE_SETTINGS_UPDATED'")).n, 1,
      'an unchanged request writes no audit row');
  });

  await t.test('cross-campus delegation works one direction at a time', async () => {
    assert.equal((await setFlags(SUPER, { allowJeninEvalRamallah: true })).status, 200);
    assert.equal((await evaluate(HIBA, 6)).status, 201, 'Jenin -> Ramallah delegated');
    assert.equal((await evaluate(HIBA, 7)).status, 201, 'members too, since member evaluation is on');
    refused(await evaluate(RAMI, 4), 'CROSS_CAMPUS_EVAL_DISABLED');
    assert.equal((await setFlags(SUPER, { allowRamallahEvalJenin: true })).status, 200);
    assert.equal((await evaluate(RAMI, 4)).status, 201, 'Ramallah -> Jenin delegated');
    // Withdrawing the delegation and member evaluation restores the defaults immediately.
    assert.equal((await setFlags(SUPER, { allowJeninEvalRamallah: false, allowRamallahEvalJenin: false, allowOrganizerMemberEval: false })).status, 200);
    refused(await evaluate(HIBA, 6), 'CROSS_CAMPUS_EVAL_DISABLED');
    refused(await evaluate(HIBA, 5), 'ORGANIZER_MEMBER_EVAL_DISABLED');
    const settings = await one('SELECT allow_organizer_member_eval AS m, allow_jenin_eval_ramallah AS j, allow_ramallah_eval_jenin AS r, updated_by FROM governance_settings');
    assert.deepEqual(settings, { m: false, j: false, r: false, updated_by: SUPER });
    assert.equal((await one("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'GOVERNANCE_SETTINGS_UPDATED'")).n, 4);
  });
});
