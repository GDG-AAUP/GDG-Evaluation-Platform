// A Manager awards points and immediately reads the team's month log (GET /api/points/team-history),
// scoped on the server; plus the chatbot data a Manager needs (team total, own rank). Real PostgreSQL.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');

const { createPointsRouter } = require('../dist/phase2/points/points.routes.js');
const { createAssistantDataRouter } = require('../dist/phase2/assistant/assistant-data.routes.js');
const { currentYearMonth } = require('../dist/phase2/shared/time.js');

const ORG = { id: 1, name: 'Org', role: 'organizer', teamId: null };
const MGR_A = { id: 2, name: 'Manager A', role: 'manager', teamId: 1 };
const MGR_B = { id: 3, name: 'Manager B', role: 'manager', teamId: 2 };
const ANN = { id: 4, name: 'Ann', role: 'member', teamId: 1 };
const SCHEMA = `hist_${process.pid}_${Date.now()}`;

test('manager team points history and chatbot team data', { skip: !process.env.DB_NAME, timeout: 90000 }, async (t) => {
  const pool = new Pool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: `-c search_path=${SCHEMA},public -c timezone=Asia/Hebron`,
  });
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  const dbDir = path.join(__dirname, '..', 'db');
  for (const file of [
    'GDG_evaluation_database.final.postgresql.sql',
    ...['002_user_invitations', '003_user_soft_delete', '004_final_backend_schema',
      '005_manager_evaluation_four_criteria', '006_asia_hebron_timestamps',
      '007_snapshot_rows_per_team_and_campus', '008_enable_remaining_modules',
      '009_registration_approval_flow', '010_points_spec_alignment', '011_governance_and_super_admin', '012_registration_request_details'].map((n) => `migrations/${n}.sql`),
  ]) {
    await pool.query(fs.readFileSync(path.join(dbDir, file), 'utf8'));
  }
  // Team 1 (Manager A): Ann, Bob. Team 2 (Manager B): Cara. Dan moved from team 1 to team 2 on the 5th.
  const cur = currentYearMonth();
  const day = (d) => `${cur.year}-${String(cur.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  await pool.query(`
    INSERT INTO teams (team_id, campus_id, team_name) VALUES (1, 1, 'Tech'), (2, 1, 'Media');
    INSERT INTO users (user_id, full_name, email, role, team_id, clerk_user_id) VALUES
      (1, 'Org', 'o@x.test', 'Organizer', NULL, 'c1'), (2, 'Manager A', 'a@x.test', 'Manager', 1, 'c2'),
      (3, 'Manager B', 'b@x.test', 'Manager', 2, 'c3'), (4, 'Ann', 'ann@x.test', 'Member', 1, 'c4'),
      (5, 'Bob', 'bob@x.test', 'Member', 1, 'c5'), (6, 'Cara', 'cara@x.test', 'Member', 2, 'c6'),
      (7, 'Dan', 'dan@x.test', 'Member', 2, 'c7');
    UPDATE teams SET manager_user_id = CASE team_id WHEN 1 THEN 2 ELSE 3 END, is_operational = TRUE;
    INSERT INTO assignment_history (user_id, team_id, role_at_time, effective_from, effective_to) VALUES
      (2, 1, 'Manager', '2026-01-01', NULL), (3, 2, 'Manager', '2026-01-01', NULL),
      (4, 1, 'Member', '2026-01-01', NULL), (5, 1, 'Member', '2026-01-01', NULL),
      (6, 2, 'Member', '2026-01-01', NULL),
      (7, 1, 'Member', '2026-01-01', '${day(5)} 00:00'), (7, 2, 'Member', '${day(5)} 00:00', NULL);
  `);
  const fixture = (userId, by, points, at, activity) => pool.query(
    `INSERT INTO point_entries (user_id, performed_by_user_id, points, activity_name, reason, effective_at)
     VALUES ($1, $2, $3, $4, 'Fixture', $5::timestamp AT TIME ZONE 'Asia/Hebron')`, [userId, by, points, activity, at]);
  await fixture(7, 2, 6, `${day(2)} 10:00`, 'Dan in Tech');       // counts for Tech (Dan was in team 1)
  await fixture(7, 3, 9, `${day(6)} 10:00`, 'Dan in Media');      // Media's, not Tech's
  await fixture(4, 1, 5, `${day(3)} 10:00`, 'Organizer award');   // organizer -> Ann (Tech)
  await fixture(6, 3, 8, `${day(3)} 11:00`, 'Media only');

  let actor = ORG;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.projectUser = actor; next(); });
  app.use('/points', createPointsRouter(pool));
  app.use('/assistant/data', createAssistantDataRouter(pool));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
    await pool.end();
  });
  const call = async (route, as, body) => {
    actor = as;
    const res = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };

  await t.test('a manager awards points and sees them at once in the team log with totals', async () => {
    const award = await call('/points', MGR_A, { userId: 5, points: 12, activityName: 'Workshop', reason: 'Led the session' });
    assert.equal(award.status, 201);
    const { status, body } = await call('/points/team-history', MGR_A);
    assert.equal(status, 200);
    const data = body.data;
    assert.equal(data.scope, 'team');
    assert.deepEqual(data.team, { id: 1, name: 'Tech' });
    assert.deepEqual([data.year, data.month], [cur.year, cur.month]);
    const mine = data.entries.find((e) => e.id === award.body.data.id);
    assert.equal(mine.userName, 'Bob');
    assert.equal(mine.points, 12);
    assert.equal(mine.activityName, 'Workshop');
    assert.equal(mine.reason, 'Led the session');
    assert.ok(mine.effectiveAt);
    assert.equal(mine.awardedByMe, true);
    assert.equal(mine.actorName, 'Manager A');
    // The team's entries, whoever recorded them; nothing from Media.
    assert.deepEqual(data.entries.map((e) => e.activityName).sort(), ['Dan in Tech', 'Organizer award', 'Workshop']);
    assert.equal(data.entries.find((e) => e.activityName === 'Organizer award').awardedByMe, false);
    assert.deepEqual(data.totals, { entries: 3, points: 23, awardedByMe: 18, awardedByMeEntries: 2 });
    assert.deepEqual(data.members.map((m) => [m.name, m.total]), [['Bob', 12], ['Dan', 6], ['Ann', 5]]);
  });

  await t.test('scope is enforced on the server', async () => {
    const media = (await call('/points/team-history', MGR_B)).body.data;
    assert.deepEqual(media.entries.map((e) => e.activityName).sort(), ['Dan in Media', 'Media only']);
    assert.equal((await call('/points/team-history', ANN)).status, 403);
    const org = (await call('/points/team-history', ORG)).body.data;
    assert.equal(org.scope, 'awarded');
    assert.deepEqual(org.entries.map((e) => e.activityName), ['Organizer award']);
    assert.equal((await call('/points/team-history?year=2026', MGR_A)).status, 400);
    assert.equal((await call('/points/team-history?year=2026&month=13', MGR_A)).status, 400);
    const past = (await call('/points/team-history?year=2026&month=1', MGR_A)).body.data;
    assert.deepEqual(past.entries, []);
  });

  await t.test('chatbot: a manager gets the team month total and their own rank', async () => {
    const board = (await call(`/assistant/data/leaderboard?scope=team&teamId=1&year=${cur.year}&month=${cur.month}`, MGR_A)).body.data;
    assert.equal(board.totalPoints, 23);
    assert.equal(board.participants, 4, 'Manager A, Ann, Bob, and Dan (in Tech earlier this month)');
    const rank = (await call(`/assistant/data/my-ranking?scope=team&year=${cur.year}&month=${cur.month}`, MGR_A)).body.data;
    assert.equal(rank.hasData, true, 'managers are ranked with their team');
    assert.equal(rank.totalPoints, 0);
    assert.equal(typeof rank.rank, 'number');
  });
});
