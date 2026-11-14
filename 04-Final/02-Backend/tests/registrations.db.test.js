// Self-registration lifecycle against real PostgreSQL (throwaway schema), with Clerk and SMTP faked:
// request form -> pending lists (every Organizer sees all) -> approve / reject -> HTML + text email.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');

const SCHEMA = `reg_${process.pid}_${Date.now()}`;

test('registration approval workflow', { skip: !process.env.DB_NAME, timeout: 90000 }, async (t) => {
  const previousEnv = { SUPER_ADMIN_CLERK_IDS: process.env.SUPER_ADMIN_CLERK_IDS, APP_LOGIN_URL: process.env.APP_LOGIN_URL };
  process.env.SUPER_ADMIN_CLERK_IDS = 'clerk_super';
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
      '009_registration_approval_flow', '011_governance_and_super_admin', '012_registration_request_details'].map((name) => `migrations/${name}.sql`),
  ]) {
    await pool.query(fs.readFileSync(path.join(dbDir, file), 'utf8'));
  }
  const campus = async (name) => (await pool.query('SELECT campus_id FROM campuses WHERE campus_name = $1', [name])).rows[0].campus_id;
  const jenin = await campus('Jenin');
  const ramallah = await campus('Ramallah');
  // Org organizes Jenin, Rami organizes Ramallah, Nour has no campus, Sara is the Super Admin.
  await pool.query(`
    INSERT INTO users (user_id, full_name, email, role, clerk_user_id, organizer_campus_id) VALUES
      (1, 'Org', 'org@x.test', 'Organizer', 'clerk_org', ${jenin}),
      (2, 'Rami', 'rami@x.test', 'Organizer', 'clerk_rami', ${ramallah}),
      (3, 'Nour', 'nour@x.test', 'Organizer', 'clerk_nour', NULL),
      (9, 'Super', 'super@x.test', 'Organizer', 'clerk_super', NULL);
    INSERT INTO teams (team_id, campus_id, team_name) VALUES (10, ${jenin}, 'Tech'), (20, ${ramallah}, 'Media');
    SELECT setval(pg_get_serial_sequence('users', 'user_id'), 100);
  `);

  const app = express();
  app.use(express.json());
  app.get('/api/auth/me', loadProjectUser, (req, res) => res.json({ data: req.projectUser }));
  app.get('/api/points/me', loadProjectUser, (req, res) => res.json({ data: [] }));
  app.use('/api/registrations/request', registrationsRoutes.requestRouter);
  app.use('/api/registrations', loadProjectUser, requireRole('organizer'), registrationsRoutes);
  app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: String(err) }); });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });

  t.after(async () => {
    mailer.setTransportForTests(null);
    await new Promise((resolve) => server.close(resolve));
    await pool.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
    await pool.end();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
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
  const ask = (clerkId, body) => call(clerkId, 'POST', '/api/registrations/request', body);
  const pendingId = async (email) => (await pool.query(
    'SELECT request_id::int AS id FROM registration_requests WHERE email = $1', [email])).rows[0].id;
  const pendingEmails = async (clerkId, url = '/api/registrations/pending') =>
    (await call(clerkId, 'GET', url)).body.data.map((r) => r.email).sort();

  await t.test('a new sign-up has no access and nothing is recorded until the form is sent', async () => {
    signUp('clerk_sara', 'Sara@X.test', 'Sara', 'Ahmad');
    const me = await call('clerk_sara', 'GET', '/api/auth/me');
    assert.equal(me.status, 403);
    assert.equal(me.body.error.code, 'REGISTRATION_REQUIRED');
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM registration_requests')).rows[0].n, 0);
  });

  await t.test('the request form is validated', async () => {
    assert.equal((await ask(null, { role: 'member', campusId: jenin })).status, 401);
    for (const body of [
      {}, { role: 'member' }, { role: 'admin', campusId: jenin }, { role: 'member', campusId: 'jenin' },
      { role: 'organizer', campusId: jenin, teamId: 10 }, { role: 'member', campusId: jenin, email: 'spoof@x.test' },
      { role: 'member', campusId: jenin, fullName: '   ' },
    ]) {
      const res = await ask('clerk_sara', body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error.code, 'INVALID_REGISTRATION_REQUEST');
    }
    assert.equal((await ask('clerk_sara', { role: 'member', campusId: ramallah, teamId: 10 })).body.error.code, 'TEAM_CAMPUS_MISMATCH');
    assert.equal((await ask('clerk_sara', { role: 'member', campusId: 999 })).body.error.code, 'CAMPUS_NOT_FOUND');
    clerkUsers.set('clerk_unverified', { emailAddresses: [{ emailAddress: 'u@x.test', verification: { status: 'unverified' } }] });
    assert.equal((await ask('clerk_unverified', { role: 'member', campusId: jenin })).body.error.code, 'EMAIL_NOT_VERIFIED');
    assert.equal((await ask('clerk_org', { role: 'member', campusId: jenin })).body.error.code, 'ALREADY_REGISTERED');
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM registration_requests')).rows[0].n, 0);
  });

  await t.test('a submitted request is pending; resubmitting updates it instead of duplicating', async () => {
    const first = await ask('clerk_sara', { fullName: 'Sara Ahmad', role: 'manager', campusId: jenin });
    assert.equal(first.status, 201);
    assert.equal(first.body.data.email, 'sara@x.test', 'the email comes from Clerk, lowercased');
    assert.equal(first.body.data.status, 'pending');
    const again = await ask('clerk_sara', { fullName: 'Sara Ahmad', role: 'manager', campusId: jenin, teamId: 10 });
    assert.equal(again.status, 200);
    assert.deepEqual(
      [again.body.data.requestedRole, again.body.data.requestedCampusName, again.body.data.requestedTeamName],
      ['manager', 'Jenin', 'Tech']);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM registration_requests')).rows[0].n, 1);
    const me = await call('clerk_sara', 'GET', '/api/auth/me');
    assert.equal(me.body.error.code, 'REGISTRATION_PENDING');
    assert.equal((await call('clerk_sara', 'GET', '/api/points/me')).body.error.code, 'REGISTRATION_PENDING');
    assert.equal((await call('clerk_sara', 'GET', '/api/registrations')).status, 403);
    assert.equal((await pool.query(`SELECT 1 FROM users WHERE email = 'sara@x.test'`)).rows.length, 0,
      'a pending person is never a project user');
  });

  await t.test('a double click on the request form: both answers succeed and one request is stored', async () => {
    signUp('clerk_twice', 'twice@x.test', 'Twice');
    const port = server.address().port;
    currentAuth = { userId: 'clerk_twice' };
    const fire = () => fetch(`http://127.0.0.1:${port}/api/registrations/request`, {
      method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'member', campusId: jenin, teamId: 10 }),
    }).then((r) => r.status);
    const statuses = (await Promise.all([fire(), fire()])).sort();
    assert.deepEqual(statuses, [200, 201], 'the second one updates the first instead of failing');
    assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM registration_requests WHERE clerk_user_id = 'clerk_twice'`)).rows[0].n, 1);
    await pool.query(`DELETE FROM registration_requests WHERE clerk_user_id = 'clerk_twice'`);
  });

  await t.test('pending lists: every Organizer sees every request (both campuses, every role, legacy too)', async () => {
    signUp('clerk_lina', 'lina@x.test', 'Lina');
    assert.equal((await ask('clerk_lina', { role: 'organizer', campusId: jenin })).status, 201);
    signUp('clerk_huda', 'huda@x.test', 'Huda');
    assert.equal((await ask('clerk_huda', { role: 'member', campusId: ramallah, teamId: 20 })).status, 201);
    // A request recorded before migration 012 has no requested values: Super Admins only.
    await pool.query(`INSERT INTO registration_requests (clerk_user_id, email, full_name) VALUES ('clerk_old', 'old@x.test', 'Old')`);
    clerkUsers.set('clerk_old', clerkUsers.get('clerk_huda'));

    const everyone = ['huda@x.test', 'lina@x.test', 'old@x.test', 'sara@x.test'];
    for (const who of ['clerk_super', 'clerk_org', 'clerk_rami', 'clerk_nour']) {
      assert.deepEqual(await pendingEmails(who), everyone, who);
    }
    assert.deepEqual(await pendingEmails('clerk_org', '/api/registrations'), everyone);
    const counts = async (who) => (await call(who, 'GET', '/api/registrations/count')).body.data.pending;
    assert.deepEqual([await counts('clerk_super'), await counts('clerk_org'), await counts('clerk_rami')], [4, 4, 4]);
    const pending = await call('clerk_super', 'GET', '/api/registrations/pending');
    assert.equal(pending.body.count, 4);
  });

  await t.test('a regular Organizer decides any request, but only a Super Admin gives the Organizer role', async () => {
    const lina = await pendingId('lina@x.test');
    const sara = await pendingId('sara@x.test');
    for (const [id, body] of [[lina, { role: 'organizer', campusId: jenin }], [sara, { role: 'organizer' }]]) {
      const res = await call('clerk_org', 'POST', `/api/registrations/${id}/approve`, body);
      assert.equal(res.status, 403, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'ORGANIZER_MANAGEMENT_RESTRICTED');
    }
    const states = await pool.query(`SELECT registration_status AS s FROM registration_requests WHERE registration_status <> 'pending'`);
    assert.equal(states.rows.length, 0);
  });

  await t.test('approval validates the assignment', async () => {
    const id = await pendingId('sara@x.test');
    const bad = [
      [{ role: 'member', campusId: jenin }, 400],
      [{ role: 'member', campusId: jenin, teamId: 20 }, 400],
      [{ role: 'organizer', teamId: 10 }, 400],
      [{ role: 'admin', campusId: jenin, teamId: 10 }, 400],
      [{ role: 'member', campusId: jenin, teamId: 999 }, 404],
    ];
    for (const [body, status] of bad) {
      assert.equal((await call('clerk_org', 'POST', `/api/registrations/${id}/approve`, body)).status, status, JSON.stringify(body));
    }
    assert.equal((await pool.query(`SELECT registration_status FROM registration_requests WHERE request_id = $1`, [id])).rows[0].registration_status, 'pending');
  });

  await t.test('the campus Organizer approves: account, team, history, audit and email with the login link', async () => {
    const id = await pendingId('sara@x.test');
    const res = await call('clerk_org', 'POST', `/api/registrations/${id}/approve`, { role: 'manager', campusId: jenin, teamId: 10 });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.emailStatus, 'sent');
    assert.equal(res.body.data.emailError, null);
    const user = (await pool.query(`SELECT user_id, role, team_id, is_active, clerk_user_id FROM users WHERE email = 'sara@x.test'`)).rows[0];
    assert.deepEqual({ ...user, user_id: undefined }, { user_id: undefined, role: 'Manager', team_id: 10, is_active: true, clerk_user_id: 'clerk_sara' });
    assert.equal((await pool.query('SELECT manager_user_id FROM teams WHERE team_id = 10')).rows[0].manager_user_id, user.user_id);
    assert.equal((await pool.query(`SELECT role_at_time FROM assignment_history WHERE user_id = $1`, [user.user_id])).rows[0].role_at_time, 'Manager');
    const audit = (await pool.query(`SELECT actor_user_id, new_values FROM audit_logs WHERE action = 'approve_registration'`)).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actor_user_id, 1);
    assert.equal(audit[0].new_values.requested_role, 'manager');
    assert.equal(audit[0].new_values.campus_id, jenin);

    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'sara@x.test');
    assert.match(sent[0].text, /تهانينا! تم قبول حسابك في منصة GDG Evaluation Platform بدور مدير في فريق Tech - فرع جنين\. يمكنك الآن تسجيل الدخول\./);
    assert.match(sent[0].text, /رابط الدخول: https:\/\/gdg\.example\/#\/login$/);
    // The HTML version: role, campus and team in both languages, and the sign-in button.
    assert.match(sent[0].subject, /تم قبول طلب انضمامك/);
    assert.match(sent[0].html, /dir="rtl"/);
    assert.match(sent[0].html, /مدير \(Manager\)/);
    assert.match(sent[0].html, /جنين \(Jenin\)/);
    assert.match(sent[0].html, /<b>Tech<\/b>/);
    assert.match(sent[0].html, /href="https:\/\/gdg\.example\/#\/login"/);

    const me = await call('clerk_sara', 'GET', '/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.data.role, 'manager');
    assert.equal(me.body.data.teamId, 10);
  });

  await t.test('a decided request cannot be decided again', async () => {
    const id = await pendingId('sara@x.test');
    assert.equal((await call('clerk_org', 'POST', `/api/registrations/${id}/reject`, {})).body.error.code, 'REGISTRATION_ALREADY_DECIDED');
    assert.equal((await ask('clerk_sara', { role: 'member', campusId: jenin })).body.error.code, 'ALREADY_REGISTERED');
  });

  await t.test('a second manager for the same team is refused', async () => {
    signUp('clerk_omar', 'omar@x.test', 'Omar');
    assert.equal((await ask('clerk_omar', { role: 'manager', campusId: jenin, teamId: 10 })).status, 201);
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
    assert.match(sent.at(-1).subject, /بخصوص طلب انضمامك/);
    assert.match(sent.at(-1).html, /<b>السبب:<\/b> Not a GDG member/);
    const rejected = (await pool.query(`SELECT notification_status FROM registration_requests WHERE request_id = $1`, [id])).rows[0];
    assert.equal(rejected.notification_status, 'sent');
    const audit = (await pool.query(`SELECT actor_user_id, new_values FROM audit_logs WHERE action = 'reject_registration' AND entity_id = $1`, [String(id)])).rows[0];
    assert.equal(audit.actor_user_id, 1);
    assert.equal(audit.new_values.status, 'rejected');
    const me = await call('clerk_omar', 'GET', '/api/auth/me');
    assert.equal(me.status, 403);
    assert.equal(me.body.error.code, 'REGISTRATION_REJECTED');
    assert.equal((await ask('clerk_omar', { role: 'member', campusId: jenin })).body.error.code, 'REGISTRATION_REJECTED');
    assert.equal((await pool.query(`SELECT 1 FROM users WHERE email = 'omar@x.test'`)).rows.length, 0);
    assert.equal((await pool.query(`SELECT rejection_reason FROM registration_requests WHERE request_id = $1`, [id])).rows[0].rejection_reason, 'Not a GDG member');
  });

  await t.test('the Super Admin approves an Organizer; a mail failure does not undo it', async () => {
    mailFails = true;
    const id = await pendingId('lina@x.test');
    const res = await call('clerk_super', 'POST', `/api/registrations/${id}/approve`, { role: 'organizer', campusId: jenin });
    mailFails = false;
    assert.equal(res.status, 200);
    assert.equal(res.body.data.emailStatus, 'failed');
    assert.equal(res.body.data.emailError.code, 'ECONNECTION', 'the Organizer is told why the email did not go out');
    assert.match(res.body.data.emailError.message, /SMTP_HOST and SMTP_PORT/);
    const user = (await pool.query(`SELECT role, team_id, is_active, organizer_campus_id FROM users WHERE email = 'lina@x.test'`)).rows[0];
    assert.deepEqual(user, { role: 'Organizer', team_id: null, is_active: true, organizer_campus_id: jenin }, 'the campus the Organizer evaluates in');
    assert.equal((await pool.query(`SELECT notification_status FROM registration_requests WHERE request_id = $1`, [id])).rows[0].notification_status, 'failed');
    const audit = (await pool.query(`SELECT new_values FROM audit_logs WHERE action = 'approve_registration' AND entity_id = (SELECT user_id::text FROM users WHERE email = 'lina@x.test')`)).rows[0];
    assert.equal(audit.new_values.actorIsSuperAdmin, true);
  });

  await t.test('any Organizer approves across campuses and decides requests without details', async () => {
    // The Jenin Organizer places Huda in a Ramallah team; the Ramallah Organizer rejects a legacy request.
    const huda = await call('clerk_org', 'POST', `/api/registrations/${await pendingId('huda@x.test')}/approve`, { role: 'member', campusId: ramallah, teamId: 20 });
    assert.equal(huda.status, 200, JSON.stringify(huda.body));
    assert.match(sent.at(-1).text, /بدور عضو في فريق Media - فرع رام الله/);
    assert.equal((await call('clerk_huda', 'GET', '/api/points/me')).status, 200);
    const old = await call('clerk_rami', 'POST', `/api/registrations/${await pendingId('old@x.test')}/reject`, {});
    assert.equal(old.status, 200);
    assert.equal(sent.at(-1).to, 'old@x.test');
    assert.deepEqual(await pendingEmails('clerk_super'), []);
  });

  await t.test('two concurrent approvals of one request create exactly one account', async () => {
    signUp('clerk_race', 'race@x.test', 'Race');
    assert.equal((await ask('clerk_race', { role: 'member', campusId: jenin, teamId: 10 })).status, 201);
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
