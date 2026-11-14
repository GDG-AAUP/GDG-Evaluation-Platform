// Runs the MVP endpoints against real PostgreSQL in a throwaway schema.
// The session is deliberately UTC, to prove month boundaries do not depend on it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');

const { createRankingsRouter } = require('../dist/phase2/rankings/rankings.routes.js');
const { createPublicRankingsRouter } = require('../dist/phase2/rankings/public-rankings.routes.js');
const { createPointsRouter } = require('../dist/phase2/points/points.routes.js');
const { createArchiveRouter } = require('../dist/phase2/archive/archive.routes.js');
const { createDashboardHandlers } = require('../dist/phase2/dashboards/dashboards.handlers.js');
const { createAssistantDataRouter } = require('../dist/phase2/assistant/assistant-data.routes.js');
const { createManagerEvaluationsRouter } = require('../dist/phase2/evaluations/manager-evaluations.routes.js');
const { currentYearMonth, monthId } = require('../dist/phase2/shared/time.js');

const ORGANIZER = { id: 1, name: 'Org', role: 'organizer', teamId: null };
const MANAGER_A = { id: 2, name: 'Manager A', role: 'manager', teamId: 1 };
const MEMBER_ANN = { id: 4, name: 'Ann', role: 'member', teamId: 1 };

const SCHEMA = `mvp_${process.pid}_${Date.now()}`;

test('MVP backend against PostgreSQL', { skip: !process.env.DB_NAME, timeout: 120000 }, async (t) => {
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
    'migrations/006_asia_hebron_timestamps.sql',
    'migrations/007_snapshot_rows_per_team_and_campus.sql',
    'migrations/007_snapshot_rows_per_team_and_campus.sql',
    'migrations/009_registration_approval_flow.sql',
    'migrations/011_governance_and_super_admin.sql',
    'migrations/012_registration_request_details.sql'
  ]) {
    await pool.query(read(file));
  }

  await pool.query(`
    INSERT INTO users (user_id, full_name, email, role, team_id, clerk_user_id, organizer_campus_id)
    VALUES (1, 'Org', 'o@x.test', 'Organizer', NULL, 'c1', 1);
    INSERT INTO teams (team_id, campus_id, team_name) VALUES (1, 1, 'Technical'), (2, 2, 'PR');
    INSERT INTO users (user_id, full_name, email, role, team_id, clerk_user_id) VALUES
      (2, 'Manager A', 'a@x.test', 'Manager', 1, 'c2'),
      (3, 'Manager B', 'b@x.test', 'Manager', 2, 'c3'),
      (4, 'Ann', 'ann@x.test', 'Member', 1, 'c4'),
      (5, 'Bob', 'bob@x.test', 'Member', 1, 'c5'),
      (6, 'Deleted Dan', 'dan@x.test', 'Member', 1, 'c6'),
      (7, 'Cara', 'cara@x.test', 'Member', 2, 'c7'),
      (8, 'Eve', 'eve@x.test', 'Member', 1, 'c8');
    UPDATE teams SET manager_user_id = team_id + 1, is_operational = TRUE;
    INSERT INTO assignment_history (user_id, team_id, role_at_time, effective_from)
      SELECT user_id, team_id, role, TIMESTAMPTZ '2025-01-01 00:00:00+00'
      FROM users WHERE team_id IS NOT NULL;
    UPDATE users SET is_active = FALSE, deleted_at = now() WHERE user_id = 6;
  `);

  const addPoints = (userId, points, at) => pool.query(
    `INSERT INTO point_entries (user_id, performed_by_user_id, points, activity_name, reason, effective_at)
     VALUES ($1, 1, $2, 'Workshop', 'Fixture', $3)`,
    [userId, points, at]
  );

  // 00:30 on 1 October in Hebron is still 30 September in UTC.
  await addPoints(4, 30, '2026-09-30T21:30:00Z');
  await addPoints(5, 30, '2026-10-05T10:00:00Z');
  await addPoints(6, 99, '2026-10-05T10:00:00Z');
  await addPoints(2, 77, '2026-10-05T10:00:00Z');
  await addPoints(8, 10, '2026-10-05T10:00:00Z');
  await addPoints(4, 5, '2026-09-10T10:00:00Z');

  let actor = ORGANIZER;
  const app = express();
  app.use(express.json());
  app.use('/public', createPublicRankingsRouter(pool));
  app.use((req, _res, next) => { req.projectUser = actor; next(); });
  app.use('/rankings', createRankingsRouter(pool));
  app.use('/points', createPointsRouter(pool));
  app.use('/archive', createArchiveRouter(pool));
  app.use('/assistant', createAssistantDataRouter(pool));
  app.use('/evaluations', createManagerEvaluationsRouter(pool));
  const dashboards = createDashboardHandlers(pool);
  app.get('/overview', dashboards.organizerOverview);
  app.get('/dashboard', dashboards.organizerDashboard);
  app.get('/ledger', dashboards.pointsLedger);
  app.get('/teams/:id/overview', (req, _res, next) => {
    req.projectTeam = { id: 1, campusId: 1, name: 'Technical', isOperational: true };
    next();
  }, dashboards.teamOverview);
  app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: String(err) }); });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
    await pool.end();
  });

  const call = async (route, as = ORGANIZER, options = {}) => {
    actor = as;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method: options.body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    return { status: response.status, body: await response.json() };
  };

  await t.test('migration 006 makes instants timezone-aware and is repeatable', async () => {
    const { rows } = await pool.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'point_entries' AND column_name = 'effective_at'`,
      [SCHEMA]
    );
    assert.equal(rows[0].data_type, 'timestamp with time zone');
  });

  await t.test('manager evaluations save on a database built by the documented setup', async () => {
    const { status, body } = await call('/evaluations/managers', ORGANIZER, {
      body: {
        evaluatedUserId: 2,
        activityName: 'Monthly review',
        activityDate: '2026-10-01',
        criteriaScores: [85, 80, 90, 75],
        comments: null
      }
    });
    assert.equal(status, 201, JSON.stringify(body));
  });

  await t.test('month boundaries follow Asia/Hebron, not the session timezone', async () => {
    const october = await call('/rankings?scope=team&teamId=1&year=2026&month=10');
    const september = await call('/rankings?scope=team&teamId=1&year=2026&month=9');
    assert.equal(october.body.data.find((r) => r.fullName === 'Ann').totalPoints, 30);
    assert.equal(september.body.data.find((r) => r.fullName === 'Ann').totalPoints, 5);
  });

  await t.test('rankings use dense rank, include Managers and exclude soft-deleted users', async () => {
    const { body } = await call('/rankings?scope=team&teamId=1&year=2026&month=10');
    assert.deepEqual(
      body.data.map((r) => [r.rank, r.fullName, r.totalPoints]),
      [[1, 'Manager A', 77], [2, 'Ann', 30], [2, 'Bob', 30], [3, 'Eve', 10]]
    );
  });

  await t.test('public summary exposes no user IDs and no excluded people', async () => {
    const { status, body } = await call('/public/public-summary?campusId=1');
    assert.equal(status, 200);
    assert.ok(!/userId/.test(JSON.stringify(body)));
    assert.ok(!/Deleted Dan|Manager A/.test(JSON.stringify(body)));
    assert.equal(body.data.month, monthId(currentYearMonth()));
  });

  await t.test('point totals use SQL SUM beyond the 50-row page', async () => {
    await pool.query(
      `INSERT INTO point_entries (user_id, performed_by_user_id, points, activity_name, reason, effective_at)
       SELECT 7, 1, 1, 'Bulk', 'Fixture', TIMESTAMPTZ '2026-08-10 10:00:00+00' + (n || ' minutes')::interval
       FROM generate_series(1, 60) n`
    );
    const page = await call('/points/me?year=2026&month=8', { id: 7, name: 'Cara', role: 'member', teamId: 2 });
    const summary = await call('/points/me/summary?year=2026&month=8', { id: 7, name: 'Cara', role: 'member', teamId: 2 });
    assert.equal(page.body.data.length, 50);
    assert.equal(summary.body.data.total, 60);
    assert.equal(summary.body.data.entryCount, 60);
    assert.equal(summary.body.data.rank, 1);
  });

  await t.test('closing a month publishes a dense-ranked snapshot exactly once', async () => {
    const closed = await call('/archive/close', ORGANIZER, { body: { year: 2026, month: 10 } });
    assert.equal(closed.status, 201, JSON.stringify(closed.body));
    assert.equal(closed.body.data.published, true);

    const snapshot = await call('/archive/2026-10?teamId=1');
    assert.deepEqual(
      snapshot.body.data.rows.map((r) => [r.rank, r.name, r.total, r.tie]),
      [[1, 'Manager A', 77, false], [2, 'Ann', 30, true], [2, 'Bob', 30, true], [3, 'Eve', 10, false]]
    );

    const again = await call('/archive/close', ORGANIZER, { body: { year: 2026, month: 10 } });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'MONTH_ALREADY_PUBLISHED');

    const totals = await pool.query('SELECT COALESCE(SUM(points), 0)::int AS sum FROM point_entries WHERE user_id = 5');
    assert.equal(totals.rows[0].sum, 30, 'closing must not change the ledger');

    const months = await call('/rankings/months', MEMBER_ANN);
    assert.deepEqual(months.body.data, ['2026-10']);

    const archive = await call('/archive');
    assert.ok(archive.body.data.months.some((m) => m.id === '2026-10' && m.status === 'archived'));
  });

  await t.test('a month that has not ended cannot be closed', async () => {
    const period = currentYearMonth();
    const { status, body } = await call('/archive/close', ORGANIZER, { body: period });
    assert.equal(status, 409);
    assert.equal(body.error.code, 'MONTH_NOT_ENDED');
  });

  await t.test('snapshots for unknown months return 404', async () => {
    assert.equal((await call('/archive/2020-01')).status, 404);
  });

  await t.test('manager dashboard returns the frontend contract from real data', async () => {
    const { status, body } = await call('/teams/1/overview', MANAGER_A);
    assert.equal(status, 200);
    assert.equal(body.data.team.campus, 'jenin');
    assert.equal(body.data.metrics.activeMembers, 3);
    assert.ok(body.data.members.some((m) => m.isMe && m.role === 'manager' && m.total === null));
    assert.ok(!body.data.members.some((m) => m.name === 'Deleted Dan'));
  });

  await t.test('organizer overview counts real active members per campus', async () => {
    await addPoints(4, 3, new Date());
    const { body } = await call('/overview');
    assert.deepEqual(body.data.members, { jenin: 3, ramallah: 1, total: 4 });
    assert.equal(body.data.managers, 2);
    assert.equal(body.data.pointsAdded, 3);
    assert.ok(body.data.recent.length > 0);
  });

  await t.test('organizer dashboard reports no invented performance scores', async () => {
    const { body } = await call('/dashboard?campus=jenin');
    assert.equal(body.data.performance.ratedCount, 0);
    assert.equal(body.data.activities.points, 3);
    assert.equal(body.data.perTeam[0].performanceAverage, null);
  });

  await t.test('chatbot data respects each role', async () => {
    assert.equal((await call('/assistant/member-points?memberName=Ann', MEMBER_ANN)).status, 403);
    assert.equal((await call('/assistant/audit-logs', MANAGER_A)).status, 403);
    assert.equal((await call('/assistant/audit-logs', MEMBER_ANN)).status, 403);
    assert.equal((await call('/assistant/manager-evaluations?campusId=1', MANAGER_A)).status, 403);
    assert.equal((await call('/assistant/team-activity?teamId=2', MANAGER_A)).status, 403);
    assert.equal((await call('/assistant/team-activity?teamId=1', MEMBER_ANN)).status, 403);
    assert.equal((await call('/assistant/member-points?memberName=Cara', MANAGER_A)).status, 404);
  });

  await t.test('chatbot data returns real figures', async () => {
    const member = await call('/assistant/member-points?memberName=Ann&year=2026&month=10', MANAGER_A);
    assert.equal(member.body.data.totalPoints, 30);

    const board = await call('/assistant/leaderboard?scope=team&teamId=1&year=2026&month=10&limit=1', MEMBER_ANN);
    assert.deepEqual(board.body.data.entries, [{ rank: 1, name: 'Manager A', totalPoints: 77 }]);

    const mine = await call('/assistant/my-ranking?scope=team&year=2026&month=10', MEMBER_ANN);
    assert.equal(mine.body.data.peopleSharingMyRank, 2);
    assert.equal(mine.body.data.gapToFirst, 47);

    const evals = await call('/assistant/my-evaluations?year=2026&month=10', MANAGER_A);
    assert.equal(evals.body.data.count, 1);

    const managers = await call('/assistant/manager-evaluations?campusId=1&year=2026&month=10');
    assert.equal(managers.body.data.totalEvaluations, 1);
  });

  await t.test('a mid-month transfer does not block closing and totals follow the ledger', async () => {
    await pool.query(`
      INSERT INTO users (user_id, full_name, email, role, team_id, clerk_user_id)
      VALUES (9, 'Tom', 'tom@x.test', 'Member', 2, 'c9');
      INSERT INTO assignment_history (user_id, team_id, role_at_time, effective_from, effective_to) VALUES
        (9, 1, 'Member', '2026-07-01T00:00:00Z', '2026-07-15T00:00:00Z'),
        (9, 2, 'Member', '2026-07-15T00:00:00Z', NULL);
    `);
    await addPoints(9, 12, '2026-07-10T10:00:00Z');
    await addPoints(9, 8, '2026-07-20T10:00:00Z');

    const closed = await call('/archive/close', ORGANIZER, { body: { year: 2026, month: 7 } });
    assert.equal(closed.status, 201, JSON.stringify(closed.body));

    const totalIn = async (query) => {
      const { body } = await call(`/archive/2026-07?${query}`);
      return body.data.rows.filter((r) => r.name === 'Tom').map((r) => [r.campus, r.total]);
    };
    assert.deepEqual(await totalIn('teamId=1'), [['jenin', 12]]);
    assert.deepEqual(await totalIn('teamId=2'), [['ramallah', 8]]);
    assert.deepEqual(await totalIn('campus=jenin'), [['jenin', 12]]);
    assert.deepEqual(await totalIn('campus=ramallah'), [['ramallah', 8]]);

    const all = await call('/archive/2026-07');
    const keys = all.body.data.rows.map((r) => `${r.userId}-${r.teamId}`);
    assert.equal(new Set(keys).size, keys.length, 'page row keys stay unique');

    const ledger = await pool.query('SELECT SUM(points)::int AS sum FROM point_entries WHERE user_id = 9');
    assert.equal(ledger.rows[0].sum, 20);
  });

  await t.test('the points ledger attributes entries to the team at the time and filters', async () => {
    const july = await call('/ledger?month=2026-07');
    assert.deepEqual(
      july.body.data.map((r) => [r.userName, r.activityPoints, r.teamsLabel, r.campus, r.archived]),
      [['Tom', 8, 'PR', 'ramallah', true], ['Tom', 12, 'Technical', 'jenin', true]]
    );
    assert.equal(july.body.data[0].type, 'activity');

    const jenin = await call('/ledger?month=2026-07&campus=jenin');
    assert.deepEqual(jenin.body.data.map((r) => r.activityPoints), [12]);
    const team2 = await call('/ledger?month=2026-07&teamId=2');
    assert.deepEqual(team2.body.data.map((r) => r.activityPoints), [8]);

    assert.deepEqual((await call('/ledger?kind=performance')).body.data, []);
    assert.equal((await call('/ledger?month=bad')).status, 400);
    assert.equal((await call('/ledger?campus=gaza')).status, 400);
  });

  await t.test('invalid chatbot queries return 400', async () => {
    assert.equal((await call('/assistant/leaderboard?scope=global&year=2026&month=10')).status, 400);
    assert.equal((await call('/assistant/my-ranking?month=13&year=2026', MEMBER_ANN)).status, 400);
  });
});
