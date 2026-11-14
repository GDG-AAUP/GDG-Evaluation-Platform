// The real Express app, as a browser on the Vite origin sees it: the CORS preflight for
// POST /api/points with Idempotency-Key, then the authenticated request itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const ORIGIN = 'http://localhost:5173';
const SCHEMA = `cors_${process.pid}_${Date.now()}`;

test('browser CORS for POST /api/points with Idempotency-Key', { skip: !process.env.DB_NAME, timeout: 90000 }, async (t) => {
  const pool = new Pool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: `-c search_path=${SCHEMA},public -c timezone=Asia/Hebron`,
  });
  const replace = (id, exports) => {
    require.cache[require.resolve(id)] = { id, filename: id, loaded: true, exports };
  };
  let clerkUserId = null;
  replace('../src/config/db', pool);
  replace('@clerk/express', {
    clerkMiddleware: () => (_req, _res, next) => next(),
    getAuth: () => (clerkUserId ? { userId: clerkUserId } : {}),
    clerkClient: { users: { getUser: async () => Promise.reject({ status: 404 }) },
      invitations: { getInvitationList: async () => ({ data: [] }) } },
  });
  delete process.env.CORS_ORIGINS; // the default allows the Vite dev origin
  const app = require('../src/app');

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
  await pool.query(`
    INSERT INTO teams (team_id, campus_id, team_name) VALUES (1, 1, 'Tech');
    INSERT INTO users (user_id, full_name, email, role, team_id, clerk_user_id) VALUES
      (1, 'Org', 'o@x.test', 'Organizer', NULL, 'clerk_org'), (2, 'Mgr', 'm@x.test', 'Manager', 1, 'clerk_mgr'),
      (3, 'Ann', 'a@x.test', 'Member', 1, 'clerk_ann');
    UPDATE teams SET manager_user_id = 2, is_operational = TRUE;
    INSERT INTO assignment_history (user_id, team_id, role_at_time, effective_from)
      SELECT user_id, team_id, role, '2026-01-01' FROM users WHERE role <> 'Organizer';
  `);

  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
    await pool.end();
  });
  const url = `http://127.0.0.1:${server.address().port}/api/points`;

  await t.test('preflight allows Idempotency-Key from the frontend origin', async () => {
    const res = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'accept,authorization,content-type,idempotency-key',
      },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
    const allowed = res.headers.get('access-control-allow-headers').toLowerCase().split(',').map((h) => h.trim());
    for (const header of ['accept', 'authorization', 'content-type', 'idempotency-key']) {
      assert.ok(allowed.includes(header), `allows ${header}`);
    }
  });

  await t.test('authenticated POST with Idempotency-Key succeeds, and a retry replays', async () => {
    clerkUserId = 'clerk_mgr';
    const send = () => fetch(url, {
      method: 'POST',
      headers: {
        Origin: ORIGIN, Accept: 'application/json', Authorization: 'Bearer token',
        'Content-Type': 'application/json', 'Idempotency-Key': 'ui-key-1',
      },
      body: JSON.stringify({ userId: 3, points: 10, activityName: 'Workshop', reason: 'Attended' }),
    });
    const first = await send();
    assert.equal(first.status, 201, JSON.stringify(await first.clone().json()));
    assert.equal(first.headers.get('access-control-allow-origin'), ORIGIN);
    const created = (await first.json()).data;
    assert.equal(created.points, 10);

    const retry = await send();
    assert.equal(retry.status, 200);
    assert.equal(retry.headers.get('idempotent-replayed'), 'true');
    assert.match(retry.headers.get('access-control-expose-headers'), /Idempotent-Replayed/i);
    assert.equal((await retry.json()).data.id, created.id);
    const count = await pool.query('SELECT COUNT(*)::int AS n FROM point_entries');
    assert.equal(count.rows[0].n, 1);
  });
});
