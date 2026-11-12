// Approved points / rankings / corrections / manager-evaluation rules against real PostgreSQL
// (throwaway schema, migrations 001-010). September 2026 is closed, October is a prior open month.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');

const { createRankingsRouter } = require('../dist/phase2/rankings/rankings.routes.js');
const { createPointsRouter } = require('../dist/phase2/points/points.routes.js');
const { createArchiveRouter } = require('../dist/phase2/archive/archive.routes.js');
const { createManagerEvaluationsRouter } = require('../dist/phase2/evaluations/manager-evaluations.routes.js');
const { createPoliciesRouter, createPointLimit } = require('../dist/phase2/policies/policies.routes.js');
const { currentYearMonth, monthId } = require('../dist/phase2/shared/time.js');

const ORG = { id: 1, name: 'Org', role: 'organizer', teamId: null };
const MGR_A = { id: 2, name: 'Manager A', role: 'manager', teamId: 1 };
const MGR_B = { id: 3, name: 'Manager B', role: 'manager', teamId: 2 };
const SCHEMA = `spec_${process.pid}_${Date.now()}`;

test('approved points, rankings, corrections and manager evaluations', { skip: !process.env.DB_NAME, timeout: 120000 }, async (t) => {
  const pool = new Pool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: `-c search_path=${SCHEMA},public -c timezone=Asia/Hebron`,
  });
  const dbDir = path.join(__dirname, '..', 'db');
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  for (const file of [
    'GDG_evaluation_database.final.postgresql.sql',
    ...['002_user_invitations', '003_user_soft_delete', '004_final_backend_schema',
      '005_manager_evaluation_four_criteria', '006_asia_hebron_timestamps',
      '007_snapshot_rows_per_team_and_campus', '008_enable_remaining_modules',
      '009_registration_approval_flow', '010_points_spec_alignment'].map((n) => `migrations/${n}.sql`),
  ]) {
    await pool.query(fs.readFileSync(path.join(dbDir, file), 'utf8'));
  }
  // Jenin: Tech (1, Manager A: Ann, Bob), Media (2, Manager B: Cara). Ramallah: Design (3, Manager R: Rami).
  await pool.query(`
    INSERT INTO teams (team_id, campus_id, team_name) VALUES (1, 1, 'Tech'), (2, 1, 'Media'), (3, 2, 'Design');
    INSERT INTO users (user_id, full_name, email, role, team_id, clerk_user_id) VALUES
      (1, 'Org', 'o@x.test', 'Organizer', NULL, 'c1'), (2, 'Manager A', 'a@x.test', 'Manager', 1, 'c2'),
      (3, 'Manager B', 'b@x.test', 'Manager', 2, 'c3'), (4, 'Ann', 'ann@x.test', 'Member', 1, 'c4'),
      (5, 'Bob', 'bob@x.test', 'Member', 1, 'c5'), (6, 'Cara', 'cara@x.test', 'Member', 2, 'c6'),
      (7, 'Rami', 'rami@x.test', 'Member', 3, 'c7'), (8, 'Manager R', 'r@x.test', 'Manager', 3, 'c8');
    UPDATE teams SET manager_user_id = CASE team_id WHEN 1 THEN 2 WHEN 2 THEN 3 ELSE 8 END, is_operational = TRUE;
    INSERT INTO assignment_history (user_id, team_id, role_at_time, effective_from)
      SELECT user_id, team_id, role, '2026-01-01' FROM users WHERE role <> 'Organizer';
    SELECT setval(pg_get_serial_sequence('users', 'user_id'), 100);
  `);
  const point = async (userId, points, at, by = 1) => (await pool.query(
    `INSERT INTO point_entries (user_id, performed_by_user_id, points, activity_name, reason, effective_at)
     VALUES ($1, $2, $3, 'Fixture', 'Fixture', $4::timestamp AT TIME ZONE 'Asia/Hebron') RETURNING entry_id::text AS id`,
    [userId, by, points, at])).rows[0].id;
  const septBob = await point(5, 20, '2026-09-10 12:00');
  await point(4, 30, '2026-09-11 12:00');
  await point(2, 10, '2026-09-12 12:00');
  await point(6, 5, '2026-09-13 12:00');
  const septRami = await point(7, 40, '2026-09-14 12:00');

  let actor = ORG;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.projectUser = actor; next(); });
  app.use('/rankings', createRankingsRouter(pool));
  app.use('/points', createPointLimit(pool), createPointsRouter(pool));
  app.use('/archive', createArchiveRouter(pool));
  app.use('/evaluations', createManagerEvaluationsRouter(pool));
  app.use('/policies', createPoliciesRouter(pool));
  app.use((err, _req, res, _next) => { res.status(500).json({ error: { code: 'INTERNAL', message: String(err) } }); });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
    await pool.end();
  });

  const call = async (route, as = ORG, { method, body, headers = {} } = {}) => {
    actor = as;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  const rows = async (sql, params) => (await pool.query(sql, params)).rows;
  const snapshot = async (scope, key, value) => (await rows(
    `SELECT u.full_name AS name, r.total_points AS total, r.rank_position AS rank
     FROM monthly_rankings r JOIN users u ON u.user_id = r.user_id
     WHERE r.year = 2026 AND r.month = 9 AND r.ranking_scope = $1 AND r.${key} = $2
       AND ($1 = 'Campus' OR r.team_id IS NOT NULL)
     ORDER BY r.rank_position, u.full_name`, [scope, value])).map((r) => [r.rank, r.name, r.total]);
  const cur = currentYearMonth();
  const curQuery = `year=${cur.year}&month=${cur.month}`;
  let reason = 0;
  const award = (userId, points, as = ORG, headers) =>
    call('/points', as, { body: { userId, points, activityName: 'Workshop', reason: `r${++reason}` }, headers });

  const closed = await call('/archive/close', ORG, { body: { year: 2026, month: 9 } });
  assert.equal(closed.status, 201, JSON.stringify(closed.body));

  await t.test('1. Managers receive points and rank alongside Members (team and campus boards)', async () => {
    assert.equal((await award(2, 15)).status, 201, 'Organizer awards Manager A');
    assert.equal((await award(2, 5, MGR_A)).status, 403, 'no self-award');
    assert.equal((await award(3, 5, MGR_A)).status, 403, 'not another team\'s Manager');
    assert.equal((await award(6, 5, MGR_A)).status, 403, 'not another team\'s Member');
    const team = await call(`/rankings?scope=team&teamId=1&${curQuery}`);
    assert.deepEqual(team.body.data.map((r) => [r.rank, r.fullName, r.totalPoints]),
      [[1, 'Manager A', 15], [2, 'Ann', 0], [2, 'Bob', 0]]);
    assert.deepEqual(await snapshot('Team', 'team_id', 1), [[1, 'Ann', 30], [2, 'Bob', 20], [3, 'Manager A', 10]]);
    const campus = await call(`/rankings?scope=campus&campusId=1&${curQuery}`);
    assert.ok(campus.body.data.some((r) => r.fullName === 'Manager B'), 'campus board lists Managers');
  });

  await t.test('2. Point range is a nonzero integer from -100 to 100 (cap 100 by default)', async () => {
    for (const points of [0, 101, -101, 2.5]) assert.equal((await award(4, points)).status, 400, `rejects ${points}`);
    assert.equal((await award(4, 100)).status, 201);
    assert.equal((await award(4, -100)).status, 201);
    const policy = await rows("SELECT policy_value AS v FROM system_policies WHERE policy_key = 'maxPointsPerOperation'");
    assert.equal(policy[0].v, 100);
  });

  await t.test('2. Duplicate submissions: short window and Idempotency-Key', async () => {
    const body = { userId: 5, points: 7, activityName: 'Talk', reason: 'Speaker' };
    const count = async () => (await rows('SELECT COUNT(*)::int AS n FROM point_entries'))[0].n;
    const first = await call('/points', ORG, { body });
    assert.equal(first.status, 201);
    const before = await count();
    const again = await call('/points', ORG, { body });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'DUPLICATE_POINT_SUBMISSION');
    assert.equal(await count(), before);

    const keyed = { userId: 5, points: 8, activityName: 'Talk', reason: 'Keyed' };
    const headers = { 'Idempotency-Key': 'retry-123' };
    const original = await call('/points', ORG, { body: keyed, headers });
    assert.equal(original.status, 201);
    const replay = await call('/points', ORG, { body: keyed, headers });
    assert.equal(replay.status, 200);
    assert.equal(replay.headers.get('idempotent-replayed'), 'true');
    assert.equal(replay.body.data.id, original.body.data.id);
    const reused = await call('/points', ORG, { body: { ...keyed, points: 9 }, headers });
    assert.equal(reused.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal((await call('/points', ORG, { body: keyed, headers: { 'Idempotency-Key': 'bad key!' } })).status, 400);

    const racing = { userId: 4, points: 3, activityName: 'Race', reason: 'Double click' };
    const both = await Promise.all([call('/points', MGR_A, { body: racing }), call('/points', MGR_A, { body: racing })]);
    assert.deepEqual(both.map((r) => r.status).sort(), [201, 409]);
  });

  await t.test('3. Reversal: once, opposite value, original month re-ranked, before/after audit', async () => {
    const res = await call(`/points/${septBob}/reverse`, MGR_A, { body: { reason: 'Wrong award' } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.points, -20);
    assert.ok(res.body.rankingRevisions > 0);
    const month = await rows(
      `SELECT to_char(effective_at AT TIME ZONE 'Asia/Hebron', 'YYYY-MM') AS m FROM point_entries WHERE reverses_entry_id = $1`, [septBob]);
    assert.equal(month[0].m, '2026-09');
    assert.deepEqual(await snapshot('Team', 'team_id', 1), [[1, 'Ann', 30], [2, 'Manager A', 10], [3, 'Bob', 0]]);
    const audit = await rows(
      "SELECT old_values, new_values FROM audit_logs WHERE action = 'reverse_point_entry' AND entity_id = $1", [res.body.data.id]);
    assert.equal(audit[0].old_values.id, septBob);
    assert.equal(audit[0].old_values.points, 20);
    assert.equal(audit[0].new_values.points, -20);
    const revised = await rows(
      `SELECT old_values, new_values, reason FROM audit_logs
       WHERE action = 'MONTHLY_RANKING_REVISED' AND new_values->>'userId' = '5' AND new_values->>'scope' = 'Team'`);
    assert.deepEqual([revised[0].old_values.totalPoints, revised[0].new_values.totalPoints], [20, 0]);
    assert.deepEqual([revised[0].old_values.rankPosition, revised[0].new_values.rankPosition], [2, 3]);
    assert.equal(revised[0].reason, 'Wrong award');
    assert.ok((await rows('SELECT 1 FROM monthly_rankings WHERE last_revised_at IS NOT NULL')).length > 0);

    const twice = await call(`/points/${septBob}/reverse`, ORG, { body: { reason: 'Again' } });
    assert.equal(twice.body.error.code, 'ALREADY_REVERSED');
    assert.equal((await call(`/points/${septRami}/reverse`, MGR_B, { body: { reason: 'x' } })).status, 403);
    await pool.query('UPDATE users SET is_active = FALSE WHERE user_id = 7');
    const global = await call(`/points/${septRami}/reverse`, ORG, { body: { reason: 'Organizer fix' } });
    assert.equal(global.status, 201, 'Organizer reverses globally, even for a deactivated person');
    assert.deepEqual(await snapshot('Campus', 'campus_id', 2), [[1, 'Manager R', 0], [1, 'Rami', 0]]);
    await pool.query('UPDATE users SET is_active = TRUE WHERE user_id = 7');
  });

  await t.test('4. Separate Jenin / Ramallah boards with DENSE_RANK; no combined board', async () => {
    const jenin = await call(`/rankings?scope=campus&campusId=1&year=2026&month=9`);
    const ramallah = await call(`/rankings?scope=campus&campusId=2&year=2026&month=9`);
    assert.ok(!jenin.body.data.some((r) => ['Rami', 'Manager R'].includes(r.fullName)));
    assert.ok(!ramallah.body.data.some((r) => ['Ann', 'Bob', 'Cara'].includes(r.fullName)));
    assert.deepEqual(jenin.body.data.map((r) => r.rank), [1, 2, 3, 4, 4]);
    const enable = await call('/policies/globalLeaderboardEnabled', ORG, { method: 'PUT', body: { value: true } });
    assert.equal(enable.status, 409);
    const policy = await rows("SELECT policy_value AS v FROM system_policies WHERE policy_key = 'globalLeaderboardEnabled'");
    assert.equal(policy[0].v, false);
  });

  await t.test('5. Closed-month correction: Manager own team, reason, atomic re-rank, before/after audit', async () => {
    const body = { month: '2026-09', userId: 5, value: 25, reason: 'Missed workshop' };
    assert.equal((await call('/archive/corrections', MGR_A, { body: { ...body, reason: ' ' } })).body.error.code,
      'CORRECTION_REASON_REQUIRED');
    for (const value of [0, 101, -101]) {
      assert.equal((await call('/archive/corrections', MGR_A, { body: { ...body, value } })).status, 400);
    }
    assert.equal((await call('/archive/corrections', MGR_A, { body: { ...body, month: monthId(cur) } })).body.error.code,
      'MONTH_NOT_CLOSED');
    assert.equal((await call('/archive/corrections', MGR_A, { body: { ...body, userId: 6 } })).status, 403, 'other team');
    assert.equal((await call('/archive/corrections', MGR_A, { body: { ...body, userId: 2 } })).status, 403, 'self');

    const res = await call('/archive/corrections', MGR_A, { body });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.closed, true);
    assert.deepEqual(await snapshot('Team', 'team_id', 1), [[1, 'Ann', 30], [2, 'Bob', 25], [3, 'Manager A', 10]]);
    const bob = res.body.data.rankingRevisions.find((r) => r.userId === 5 && r.scope === 'Team');
    assert.deepEqual(bob.before, { totalPoints: 0, rankPosition: 3 });
    assert.deepEqual(bob.after, { totalPoints: 25, rankPosition: 2 });
    const audits = await rows(
      `SELECT l.action, l.reason, l.actor_user_id FROM audit_logs l
       WHERE l.batch_id = (SELECT batch_id FROM audit_logs WHERE action = 'CLOSED_MONTH_CORRECTION' ORDER BY audit_id DESC LIMIT 1)`);
    assert.equal(audits.filter((a) => a.action === 'MONTHLY_RANKING_REVISED').length, res.body.data.rankingRevisions.length);
    assert.ok(audits.every((a) => a.reason === 'Missed workshop' && a.actor_user_id === 2));
    const entry = await rows(
      `SELECT to_char(effective_at AT TIME ZONE 'Asia/Hebron', 'YYYY-MM') AS m FROM point_entries WHERE entry_id = $1`,
      [res.body.data.entry.id]);
    assert.equal(entry[0].m, '2026-09');

    const org = await call('/archive/corrections', ORG, { body: { month: '2026-09', userId: 7, value: -5, reason: 'Global' } });
    assert.equal(org.status, 201, 'Organizer corrects across campuses');
    assert.deepEqual(await snapshot('Campus', 'campus_id', 2), [[1, 'Manager R', 0], [2, 'Rami', -5]]);

    const open = await call('/archive/corrections', ORG, { body: { month: '2026-10', userId: 4, value: 3, reason: 'Prior open month' } });
    assert.equal(open.status, 201);
    assert.equal(open.body.data.closed, false);
    assert.deepEqual(open.body.data.rankingRevisions, []);

    // Atomic: an audit failure leaves the ledger and the snapshot exactly as they were.
    const ledger = (await rows('SELECT COUNT(*)::int AS n FROM point_entries'))[0].n;
    const before = await snapshot('Team', 'team_id', 1);
    await pool.query(`ALTER TABLE audit_logs ADD CONSTRAINT spec_reject CHECK (reason IS DISTINCT FROM 'boom')`);
    const failed = await call('/archive/corrections', MGR_A, { body: { ...body, reason: 'boom' } });
    assert.equal(failed.status, 500);
    await pool.query('ALTER TABLE audit_logs DROP CONSTRAINT spec_reject');
    assert.equal((await rows('SELECT COUNT(*)::int AS n FROM point_entries'))[0].n, ledger);
    assert.deepEqual(await snapshot('Team', 'team_id', 1), before);

    const managerView = await call('/archive', MGR_A);
    assert.deepEqual(managerView.body.data.members.map((m) => m.name).sort(), ['Ann', 'Bob']);
    assert.equal((await call('/archive/close', MGR_A, { body: { year: 2026, month: 10 } })).status, 403);
  });

  await t.test('6. Manager evaluations: Organizer only, 0-100, several per month, arithmetic mean, audit', async () => {
    const evaluate = (scores, activityDate, as = ORG) => call('/evaluations/managers', as, {
      body: { evaluatedUserId: 2, activityName: 'Monthly review', activityDate, criteriaScores: scores },
    });
    assert.equal((await evaluate([80, 80, 80, 80], '2026-10-03')).status, 201);
    assert.equal((await evaluate([60, 70, 50, 40], '2026-10-20')).status, 201); // weighted 57
    assert.equal((await evaluate([101, 80, 80, 80], '2026-10-21')).status, 400);
    assert.equal((await evaluate([-1, 80, 80, 80], '2026-10-21')).status, 400);
    assert.equal((await evaluate([80, 80, 80, 80], '2026-10-21', MGR_B)).status, 403);
    const average = await call('/evaluations/managers/2/average?year=2026&month=10');
    assert.equal(average.body.data.evaluationCount, 2);
    assert.equal(average.body.data.averageScore, 68.5);
    const kept = await rows('SELECT criteria_total_score AS s FROM performance_evaluations WHERE evaluated_user_id = 2 ORDER BY 1');
    assert.deepEqual(kept.map((r) => r.s), [57, 80]);
    const audit = await rows(
      "SELECT actor_user_id, reason, new_values, created_at FROM audit_logs WHERE action = 'PERFORMANCE_EVALUATION_CREATED'");
    assert.equal(audit.length, 2);
    assert.ok(audit.every((a) => a.actor_user_id === 1 && /Monthly review/.test(a.reason) && a.created_at));
    assert.deepEqual(audit.map((a) => a.new_values.totalScore).sort(), [57, 80]);
  });
});
