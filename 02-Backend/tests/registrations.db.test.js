// Self-registration lifecycle against real PostgreSQL (throwaway schema), with Clerk and SMTP faked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');

const SCHEMA = `reg_${process.pid}_${Date.now()}`;

test('registration approval workflow', { skip: !process.env.DB_NAME, timeout: 90000 }, async (t) => {
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
    getAuth: () => currentAuth,
    clerkClient: {
      users: { getUser: async (id) => clerkUsers.get(id) ?? Promise.reject({ status: 404 }) },
      invitations: { getInvitationList: async () => ({ data: [] }) },
    },
  });
  const sent = [];
  let mailFails = false;
  const mailer = require('../src/services/mailer.service');
  mailer.setTransportForTests({
    sendMail: async (message) => {
      if (mailFails) throw Object.assign(new Error('down'), { code: 'ECONNECTION' });
      sent.push(message);
    },
  });
  const loadProjectUser = require('../src/middleware/load-project-user');
  const requireRole = require('../src/middleware/require-role');
  const registrationsRoutes = require('../src/routes/registrations.routes');

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
  await pool.query(`
    INSERT INTO users (user_id, full_name, email, role, clerk_user_id) VALUES (1, 'Org', 'org@x.test', 'Organizer', 'clerk_org');
    INSERT INTO teams (team_id, campus_id, team_name) VALUES
      (10, (SELECT campus_id FROM campuses WHERE campus_name = 'Jenin'), 'Tech'),
      (20, (SELECT campus_id FROM campuses WHERE campus_name = 'Ramallah'), 'Media');
    SELECT setval(pg_get_serial_sequence('users', 'user_id'), 100);
  `);
  const campus = async (name) => (await pool.query('SELECT campus_id FROM campuses WHERE campus_name = $1', [name])).rows[0].campus_id;
  const jenin = await campus('Jenin');
  const ramallah = await campus('Ramallah');

  const app = express();
  app.use(express.json());
  app.get('/api/auth/me', loadProjectUser, (req, res) => res.json({ data: req.projectUser }));
  app.get('/api/points/me', loadProjectUser, (req, res) => res.json({ data: [] }));
  app.use('/api/registrations', loadProjectUser, requireRole('organizer'), registrationsRoutes);
  app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: String(err) }); });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });

  t.after(async () => {
    mailer.setTransportForTests(null);
    await new Promise((resolve) => server.close(resolve));
    await pool.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
    await pool.end();
  });

  const call = async (clerkId, method, url, body) => {
    currentAuth = clerkId ? { userId: clerkId } : {};
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method,
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const signUp = (id, email, firstName, lastName = '') => clerkUsers.set(id, {
    firstName, lastName, primaryEmailAddressId: 'e1',
    emailAddresses: [{ id: 'e1', emailAddress: email, verification: { status: 'verified' } }],
  });
  const pendingId = async (email) => (await pool.query(
    'SELECT request_id::int AS id FROM registration_requests WHERE email = $1', [email])).rows[0].id;

  await t.test('a new sign-up becomes a pending request and gets no access', async () => {
    signUp('clerk_sara', 'Sara@X.test', 'Sara', 'Ahmad');
    const me = await call('clerk_sara', 'GET', '/api/auth/me');
    assert.equal(me.status, 403);
    assert.equal(me.body.error.code, 'REGISTRATION_PENDING');
    const { rows } = await pool.query('SELECT full_name, email, registration_status FROM registration_requests');
    assert.deepEqual(rows, [{ full_name: 'Sara Ahmad', email: 'sara@x.test', registration_status: 'pending' }]);
    const users = await pool.query(`SELECT 1 FROM users WHERE email = 'sara@x.test'`);
    assert.equal(users.rows.length, 0, 'a pending person is never a project user');
  });

  await t.test('a pending user cannot reach protected endpoints, and repeats do not duplicate', async () => {
    assert.equal((await call('clerk_sara', 'GET', '/api/points/me')).body.error.code, 'REGISTRATION_PENDING');
    assert.equal((await call('clerk_sara', 'GET', '/api/registrations')).status, 403);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM registration_requests');
    assert.equal(rows[0].n, 1);
  });

  await t.test('an unverified email is not recorded', async () => {
    clerkUsers.set('clerk_unverified', { emailAddresses: [{ emailAddress: 'u@x.test', verification: { status: 'unverified' } }] });
    const res = await call('clerk_unverified', 'GET', '/api/auth/me');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'USER_NOT_FOUND_IN_DB');
  });

  await t.test('organizers see the pending list and count', async () => {
    const list = await call('clerk_org', 'GET', '/api/registrations');
    assert.equal(list.status, 200);
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.data[0].email, 'sara@x.test');
    assert.equal((await call('clerk_org', 'GET', '/api/registrations/count')).body.data.pending, 1);
  });

  await t.test('approval validates the assignment', async () => {
    const id = await pendingId('sara@x.test');
    const bad = [
      [{ role: 'member', campusId: jenin }, 400],
      [{ role: 'member', campusId: ramallah, teamId: 10 }, 400],
      [{ role: 'organizer', teamId: 10 }, 400],
      [{ role: 'admin', campusId: jenin, teamId: 10 }, 400],
      [{ role: 'member', campusId: jenin, teamId: 999 }, 404],
    ];
    for (const [body, status] of bad) {
      assert.equal((await call('clerk_org', 'POST', `/api/registrations/${id}/approve`, body)).status, status, JSON.stringify(body));
    }
    assert.equal((await pool.query(`SELECT registration_status FROM registration_requests WHERE request_id = $1`, [id])).rows[0].registration_status, 'pending');
  });

  await t.test('approval activates the account with role, team and campus, and emails it', async () => {
    const id = await pendingId('sara@x.test');
    const res = await call('clerk_org', 'POST', `/api/registrations/${id}/approve`, { role: 'manager', campusId: jenin, teamId: 10 });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.emailStatus, 'sent');
    const user = (await pool.query(`SELECT user_id, role, team_id, is_active, clerk_user_id FROM users WHERE email = 'sara@x.test'`)).rows[0];
    assert.deepEqual({ ...user, user_id: undefined }, { user_id: undefined, role: 'Manager', team_id: 10, is_active: true, clerk_user_id: 'clerk_sara' });
    assert.equal((await pool.query('SELECT manager_user_id FROM teams WHERE team_id = 10')).rows[0].manager_user_id, user.user_id);
    assert.equal((await pool.query(`SELECT role_at_time FROM assignment_history WHERE user_id = $1`, [user.user_id])).rows[0].role_at_time, 'Manager');
    assert.equal((await pool.query(`SELECT 1 FROM audit_logs WHERE action = 'approve_registration'`)).rows.length, 1);

    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'sara@x.test');
    assert.match(sent[0].text, /تهانينا! تم قبول حسابك في منصة GDG Evaluation Platform بدور مدير في فريق Tech - فرع جنين\. يمكنك الآن تسجيل الدخول\./);

    const me = await call('clerk_sara', 'GET', '/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.data.role, 'manager');
    assert.equal(me.body.data.teamId, 10);
  });

  await t.test('a decided request cannot be decided again', async () => {
    const id = await pendingId('sara@x.test');
    assert.equal((await call('clerk_org', 'POST', `/api/registrations/${id}/reject`, {})).body.error.code, 'REGISTRATION_ALREADY_DECIDED');
  });

  await t.test('a second manager for the same team is refused', async () => {
    signUp('clerk_omar', 'omar@x.test', 'Omar');
    await call('clerk_omar', 'GET', '/api/auth/me');
    const id = await pendingId('omar@x.test');
    const res = await call('clerk_org', 'POST', `/api/registrations/${id}/approve`, { role: 'manager', campusId: jenin, teamId: 10 });
    assert.equal(res.body.error.code, 'TEAM_MANAGER_EXISTS');
  });

  await t.test('rejection keeps the person out and emails the reason', async () => {
    const id = await pendingId('omar@x.test');
    const res = await call('clerk_org', 'POST', `/api/registrations/${id}/reject`, { reason: 'Not a GDG member' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.emailStatus, 'sent');
    assert.equal(sent.at(-1).to, 'omar@x.test');
    assert.match(sent.at(-1).text, /^نعتذر، تم رفض طلب انضمامك إلى منصة GDG Evaluation Platform\.\nالسبب: Not a GDG member$/);
    const me = await call('clerk_omar', 'GET', '/api/auth/me');
    assert.equal(me.status, 403);
    assert.equal(me.body.error.code, 'REGISTRATION_REJECTED');
    assert.equal((await pool.query(`SELECT 1 FROM users WHERE email = 'omar@x.test'`)).rows.length, 0);
    assert.equal((await pool.query(`SELECT rejection_reason FROM registration_requests WHERE request_id = $1`, [id])).rows[0].rejection_reason, 'Not a GDG member');
  });

  await t.test('an organizer approval has no team, and a mail failure does not undo it', async () => {
    signUp('clerk_lina', 'lina@x.test', 'Lina');
    await call('clerk_lina', 'GET', '/api/auth/me');
    mailFails = true;
    const id = await pendingId('lina@x.test');
    const res = await call('clerk_org', 'POST', `/api/registrations/${id}/approve`, { role: 'organizer' });
    mailFails = false;
    assert.equal(res.status, 200);
    assert.equal(res.body.data.emailStatus, 'failed');
    const user = (await pool.query(`SELECT role, team_id, is_active FROM users WHERE email = 'lina@x.test'`)).rows[0];
    assert.deepEqual(user, { role: 'Organizer', team_id: null, is_active: true });
    assert.equal((await pool.query(`SELECT notification_status FROM registration_requests WHERE request_id = $1`, [id])).rows[0].notification_status, 'failed');
  });

  await t.test('a member approval assigns the team in the chosen campus', async () => {
    signUp('clerk_huda', 'huda@x.test', 'Huda');
    await call('clerk_huda', 'GET', '/api/auth/me');
    const id = await pendingId('huda@x.test');
    const res = await call('clerk_org', 'POST', `/api/registrations/${id}/approve`, { role: 'member', campusId: ramallah, teamId: 20 });
    assert.equal(res.status, 200);
    assert.match(sent.at(-1).text, /بدور عضو في فريق Media - فرع رام الله/);
    assert.equal((await call('clerk_huda', 'GET', '/api/points/me')).status, 200);
  });

  await t.test('two concurrent approvals of one request create exactly one account', async () => {
    signUp('clerk_race', 'race@x.test', 'Race');
    await call('clerk_race', 'GET', '/api/auth/me');
    const id = await pendingId('race@x.test');
    currentAuth = { userId: 'clerk_org' };
    const port = server.address().port;
    const fire = () => fetch(`http://127.0.0.1:${port}/api/registrations/${id}/approve`, {
      method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'member', campusId: jenin, teamId: 10 }),
    }).then((r) => r.status);
    const statuses = (await Promise.all([fire(), fire()])).sort();
    assert.deepEqual(statuses, [200, 409]);
    assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE email = 'race@x.test'`)).rows[0].n, 1);
  });
});
