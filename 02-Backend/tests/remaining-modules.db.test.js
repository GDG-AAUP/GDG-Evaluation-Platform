// Runs Policies, System Log, scorecards, activities and awards against real PostgreSQL.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');

const { createPoliciesRouter, createPointLimit } = require('../dist/phase2/policies/policies.routes.js');
const { createSyslogRouter } = require('../dist/phase2/system/syslog.routes.js');
const { createRatingsRouter, validateScores } = require('../dist/phase2/ratings/ratings.routes.js');
const { createActivitiesRouter } = require('../dist/phase2/activities/activities.routes.js');
const { createAwardsRouter } = require('../dist/phase2/awards/awards.routes.js');
const { createPublicRankingsRouter } = require('../dist/phase2/rankings/public-rankings.routes.js');
const { createPointsRouter } = require('../dist/phase2/points/points.routes.js');
const { createDashboardHandlers } = require('../dist/phase2/dashboards/dashboards.handlers.js');
const { currentYearMonth, monthId } = require('../dist/phase2/shared/time.js');

const ORG = { id: 1, name: 'Org', role: 'organizer', teamId: null };
const MGR_A = { id: 2, name: 'Mgr A', role: 'manager', teamId: 1 };
const ANN = { id: 4, name: 'Ann', role: 'member', teamId: 1 };
const SCHEMA = `mods_${process.pid}_${Date.now()}`;
const FULL = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`cat${i + 1}`, i < 5 ? 8 : 4]));

test('validateScores enforces all 15 bounded items', () => {
  const valid = validateScores(FULL);
  assert.equal(valid.total, 80);
  assert.equal(valid.core, 40);
  assert.equal(validateScores({ ...FULL, cat1: 11 }), null);
  assert.equal(validateScores({ ...FULL, cat6: '1.5' }), null);
  assert.equal(validateScores({ ...FULL, extra: 1 }), null);
  const { cat15, ...missing } = FULL;
  assert.equal(validateScores(missing), null);
  assert.equal(validateScores({ ...FULL, cat2: '7' }).scores.cat2, 7);
});

test('remaining modules against PostgreSQL', { skip: !process.env.DB_NAME, timeout: 120000 }, async (t) => {
  const { writeSystemLog } = require('../src/services/system-log.service');
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: `-c search_path=${SCHEMA},public -c timezone=UTC`
  });
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'db', file), 'utf8');
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  for (const file of [
    'GDG_evaluation_database.final.postgresql.sql',
    'migrations/002_user_invitations.sql',
    'migrations/003_user_soft_delete.sql',
    'migrations/004_final_backend_schema.sql',
    'migrations/005_manager_evaluation_four_criteria.sql',
    'migrations/006_asia_hebron_timestamps.sql',
    'migrations/007_snapshot_rows_per_team_and_campus.sql',
    'migrations/008_enable_remaining_modules.sql',
    'migrations/008_enable_remaining_modules.sql'
  ]) {
    await pool.query(read(file));
  }

  await pool.query(`
    INSERT INTO users (user_id, full_name, email, role, team_id, clerk_user_id)
      VALUES (1, 'Org', 'o@x.test', 'Organizer', NULL, 'c1');
    INSERT INTO teams (team_id, campus_id, team_name) VALUES (1, 1, 'Technical'), (2, 2, 'PR');
    INSERT INTO users (user_id, full_name, email, role, team_id, clerk_user_id) VALUES
      (2, 'Mgr A', 'a@x.test', 'Manager', 1, 'c2'),
      (3, 'Mgr B', 'b@x.test', 'Manager', 2, 'c3'),
      (4, 'Ann', 'ann@x.test', 'Member', 1, 'c4'),
      (5, 'Bob', 'bob@x.test', 'Member', 1, 'c5'),
      (6, 'Cara', 'cara@x.test', 'Member', 2, 'c6');
    UPDATE teams SET manager_user_id = team_id + 1, is_operational = TRUE;
    INSERT INTO assignment_history (user_id, team_id, role_at_time, effective_from)
      SELECT user_id, team_id, role, TIMESTAMPTZ '2025-01-01 00:00:00+00'
      FROM users WHERE team_id IS NOT NULL;
  `);

  let actor = ORG;
  const app = express();
  app.use(express.json());
  app.use('/public', createPublicRankingsRouter(pool));
  app.use((req, _res, next) => { req.projectUser = actor; next(); });
  app.use('/policies', createPoliciesRouter(pool));
  app.use('/syslog', createSyslogRouter(pool));
  app.use('/ratings', createRatingsRouter(pool));
  app.use('/activities', createActivitiesRouter(pool));
  app.use('/awards', createAwardsRouter(pool));
  app.use('/points', createPointLimit(pool), createPointsRouter(pool));
  app.get('/dashboard', createDashboardHandlers(pool).organizerDashboard);
  app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: String(err) }); });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
    await pool.end();
    await require('../src/config/db').end();
  });

  const call = async (method, route, as = ORG, body) => {
    actor = as;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  };
  const month = monthId(currentYearMonth());

  await t.test('every role reads policies; only organizers change them, with an audit row', async () => {
    assert.equal((await call('GET', '/policies', ANN)).body.data.maxPointsPerOperation, 50);
    assert.equal((await call('PUT', '/policies/maxPointsPerOperation', MGR_A, { value: 40 })).status, 403);

    const saved = await call('PUT', '/policies/maxPointsPerOperation', ORG, { value: 40 });
    assert.equal(saved.body.data.maxPointsPerOperation, 40);
    const viaBody = await call('PUT', '/policies', ORG, { key: 'globalLeaderboardEnabled', value: false });
    assert.equal(viaBody.body.data.globalLeaderboardEnabled, false);

    const audit = await pool.query(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'UPDATE_POLICY'`);
    assert.equal(audit.rows[0].n, 2);
  });

  await t.test('invalid and unsupported policy values are refused', async () => {
    assert.equal((await call('PUT', '/policies/maxPointsPerOperation', ORG, { value: 101 })).status, 400);
    assert.equal((await call('PUT', '/policies/globalLeaderboardEnabled', ORG, { value: 'yes' })).status, 400);
    assert.equal((await call('PUT', '/policies/nope', ORG, { value: 1 })).status, 404);
    assert.equal((await call('PUT', '/policies/__proto__', ORG, { value: 1 })).status, 404);
    const refused = await call('PUT', '/policies/multipleManagersPerTeam', ORG, { value: true });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'POLICY_NOT_SUPPORTED');
  });

  await t.test('the points limit is enforced on real point operations', async () => {
    const over = await call('POST', '/points', ORG, { userId: 4, points: 41, activityName: 'x', reason: 'y' });
    assert.equal(over.status, 400);
    assert.equal(over.body.error.code, 'POINTS_LIMIT_EXCEEDED');
    assert.equal((await call('POST', '/points', ORG, { userId: 4, points: 40, activityName: 'x', reason: 'y' })).status, 201);
  });

  await t.test('system log returns real events, filtered and paginated', async () => {
    await writeSystemLog('info', 'Backend started', 'server', pool);
    await writeSystemLog('error', 'Unexpected Error on GET /api/x', 'api', pool);
    const all = await call('GET', '/syslog');
    assert.equal(all.body.total, 2);
    assert.deepEqual(Object.keys(all.body.data[0]).sort(), ['id', 'level', 'msg', 'src', 'ts']);
    assert.equal((await call('GET', '/syslog?level=error')).body.data.length, 1);
    assert.equal((await call('GET', '/syslog?page=1&pageSize=1')).body.data.length, 1);
    assert.equal((await call('GET', '/syslog?level=fatal')).status, 400);
  });

  await t.test('scorecards enforce scope, keep revisions and detect stale saves', async () => {
    const targets = await call('GET', '/ratings/targets', MGR_A);
    assert.deepEqual(targets.body.data.map((p) => p.name).sort(), ['Ann', 'Bob']);
    assert.equal((await call('GET', '/ratings/targets', ANN)).status, 403);

    const save = (as, userId, extra = {}) =>
      call('POST', '/ratings', as, { userId, month, scores: FULL, reason: 'Good month', expectedRev: 0, ...extra });
    assert.equal((await save(MGR_A, 6)).status, 403, 'other team');
    assert.equal((await save(ANN, 5)).status, 403, 'members cannot rate');
    assert.equal((await save(ORG, 1)).status, 403, 'not yourself');
    assert.equal((await save(MGR_A, 4, { scores: { ...FULL, cat1: 99 } })).status, 400);
    assert.equal((await save(MGR_A, 4, { reason: '  ' })).status, 400);

    const first = await save(MGR_A, 4);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.data.total, 80);
    assert.equal(first.body.data.rev, 1);

    const stale = await save(MGR_A, 4);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'SCORECARD_CHANGED');
    assert.equal((await save(MGR_A, 4, { expectedRev: 1 })).body.data.rev, 2);

    const own = await call('GET', `/ratings/4?month=${month}`, ANN);
    assert.equal(own.body.data.current.rev, 2);
    assert.equal(own.body.data.history.length, 2);
    assert.equal(own.body.data.history[0].actorName, 'Mgr A');
    assert.equal((await call('GET', '/ratings/5', ANN)).status, 403, 'another member');
    assert.equal((await call('GET', '/ratings/6', MGR_A)).status, 403, 'other team');

    const past = await save(MGR_A, 5, { month: '2020-01' });
    assert.equal(past.status, 409);
    assert.equal(past.body.error.code, 'MONTH_LOCKED');
  });

  await t.test('the organizer dashboard reports real scorecard results', async () => {
    const { body } = await call('GET', '/dashboard?campus=jenin');
    assert.equal(body.data.performance.ratedCount, 1);
    assert.equal(body.data.performance.average, 80);
    assert.equal(body.data.perTeam[0].performanceAverage, 80);
  });

  await t.test('activities are stored in the ledger, scoped by role, and may be zero points', async () => {
    const add = (as, userId, extra = {}) =>
      call('POST', '/activities', as, { userId, month, label: 'Workshop', points: 30, description: 'Led it', ...extra });
    assert.equal((await add(MGR_A, 6)).status, 403);
    assert.equal((await add(ANN, 5)).status, 403);
    assert.equal((await add(ORG, 4, { points: 100 })).status, 400);
    assert.equal((await add(ORG, 4, { description: ' ' })).status, 400);
    assert.equal((await add(MGR_A, 5, { points: 60 })).status, 201);
    assert.equal((await add(MGR_A, 5, { points: 0, label: 'Attended' })).status, 201);
    assert.equal((await add(ORG, 2, { points: 5, label: 'Led team' })).status, 201, 'organizers can credit managers');

    const asOrg = await call('GET', '/activities', ORG);
    assert.equal(asOrg.status, 200);
    const bob = asOrg.body.data.rows.find((r) => r.name === 'Bob');
    assert.equal(bob.total, 60);
    assert.equal(bob.entries.length, 2);
    assert.equal(bob.canRate, true);
    assert.equal(asOrg.body.data.locked, false);

    const asMember = await call('GET', '/activities', ANN);
    assert.deepEqual(asMember.body.data.rows.map((r) => r.name), ['Ann']);
    assert.equal(asMember.body.data.rows[0].canRate, false);
    assert.equal(typeof asMember.body.data.rows[0].percentage, 'number');
  });

  await t.test('awards are limited to organizers and current leaders, and public without IDs', async () => {
    const hall = await call('GET', '/awards?campus=jenin', ANN);
    assert.equal(hall.status, 200, JSON.stringify(hall.body));
    assert.equal(hall.body.data.groups[0].leader.name, 'Bob');
    assert.equal(hall.body.data.winner, null);

    const pick = (as, userId) => call('POST', '/awards', as, { campus: 'jenin', month, userId });
    assert.equal((await pick(MGR_A, 5)).status, 403);
    assert.equal((await pick(ORG, 4)).status, 400, 'not the leader');
    const chosen = await pick(ORG, 5);
    assert.equal(chosen.status, 201, JSON.stringify(chosen.body));

    const after = await call('GET', '/awards?campus=jenin', ANN);
    assert.equal(after.body.data.winner.name, 'Bob');
    assert.equal(after.body.data.winnerActivities.length, 2);
    assert.equal(after.body.data.stale, false);

    const open = await call('GET', '/public/public-summary?campusId=1');
    assert.equal(open.body.data.winner.name, 'Bob');
    assert.ok(!/userId/.test(JSON.stringify(open.body)));
  });

  await t.test('an award goes stale when its winner stops leading the team', async () => {
    await call('POST', '/activities', MGR_A, { userId: 4, month, label: 'Big', points: 99, description: 'Won' });
    const { body } = await call('GET', '/awards?campus=jenin', ANN);
    assert.equal(body.data.winner, null);
    assert.equal(body.data.stale, true);
  });

  await t.test('invalid award queries return 400', async () => {
    assert.equal((await call('GET', '/awards?campus=gaza')).status, 400);
    assert.equal((await call('GET', '/awards?month=bad')).status, 400);
  });
});
