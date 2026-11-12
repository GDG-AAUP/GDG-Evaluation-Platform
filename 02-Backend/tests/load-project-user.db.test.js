// Exercises sign-in outcomes against real PostgreSQL in a throwaway schema, with Clerk faked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');

const SCHEMA = `auth_${process.pid}_${Date.now()}`;

test('load-project-user sign-in outcomes', { skip: !process.env.DB_NAME, timeout: 60000 }, async (t) => {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: `-c search_path=${SCHEMA},public`
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
      invitations: { getInvitationList: async () => ({ data: [] }) }
    }
  });
  const loadProjectUser = require('../src/middleware/load-project-user');

  const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'db', file), 'utf8');
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  for (const file of [
    'GDG_evaluation_database.final.postgresql.sql',
    'migrations/002_user_invitations.sql',
    'migrations/003_user_soft_delete.sql',
    'migrations/004_final_backend_schema.sql',
    'migrations/009_registration_approval_flow.sql'
  ]) {
    await pool.query(read(file));
  }
  await pool.query(`
    INSERT INTO users (user_id, full_name, email, role, clerk_user_id) VALUES
      (1, 'Placeholder Org', 'org@x.test', 'Organizer', 'user_xxx'),
      (2, 'Exact Org', 'exact@x.test', 'Organizer', 'clerk_exact'),
      (3, 'Off Org', 'off@x.test', 'Organizer', 'clerk_old_off');
    UPDATE users SET is_active = FALSE WHERE user_id = 3;
  `);

  const app = express();
  app.get('/me', loadProjectUser, (req, res) => res.json({ data: req.projectUser }));
  app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: String(err) }); });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
    await pool.end();
  });

  const signIn = async (auth, bearer = true) => {
    currentAuth = auth;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/me`, {
      headers: bearer ? { Authorization: 'Bearer token' } : {}
    });
    return { status: response.status, body: await response.json() };
  };
  const verified = (emailAddress, status = 'verified') => ({
    publicMetadata: {},
    emailAddresses: [{ emailAddress, verification: { status } }]
  });

  await t.test('no header reports TOKEN_MISSING', async () => {
    const { status, body } = await signIn({}, false);
    assert.equal(status, 401);
    assert.equal(body.error.code, 'UNAUTHENTICATED');
    assert.equal(body.error.reason, 'TOKEN_MISSING');
  });

  await t.test('a rejected token reports INVALID_TOKEN', async () => {
    const { status, body } = await signIn({});
    assert.equal(status, 401);
    assert.equal(body.error.reason, 'INVALID_TOKEN');
  });

  await t.test('an exact Clerk ID signs in without a Clerk lookup', async () => {
    const { status, body } = await signIn({ userId: 'clerk_exact' });
    assert.equal(status, 200);
    assert.equal(body.data.id, 2);
  });

  await t.test('an unknown user with a verified email becomes a pending registration request', async () => {
    clerkUsers.set('clerk_new', verified('nobody@x.test'));
    const { status, body } = await signIn({ userId: 'clerk_new' });
    assert.equal(status, 403);
    assert.equal(body.error.code, 'REGISTRATION_PENDING');
    const { rows } = await pool.query(`SELECT registration_status FROM registration_requests WHERE clerk_user_id = 'clerk_new'`);
    assert.equal(rows[0].registration_status, 'pending');
  });

  await t.test('an unknown user without a verified email reports USER_NOT_FOUND_IN_DB with the Clerk ID', async () => {
    clerkUsers.set('clerk_noemail', verified('none@x.test', 'unverified'));
    const { status, body } = await signIn({ userId: 'clerk_noemail' });
    assert.equal(status, 401);
    assert.equal(body.error.code, 'USER_NOT_FOUND_IN_DB');
    assert.equal(body.error.clerk_user_id, 'clerk_noemail');
  });

  await t.test('an unverified email never links an account', async () => {
    clerkUsers.set('clerk_unverified', verified('org@x.test', 'unverified'));
    assert.equal((await signIn({ userId: 'clerk_unverified' })).status, 401);
    const { rows } = await pool.query('SELECT clerk_user_id FROM users WHERE user_id = 1');
    assert.equal(rows[0].clerk_user_id, 'user_xxx');
  });

  await t.test('a verified email repairs a wrong Clerk ID and is audited', async () => {
    clerkUsers.set('clerk_real', verified('ORG@x.test'));
    const { status, body } = await signIn({ userId: 'clerk_real' });
    assert.equal(status, 200);
    assert.equal(body.data.role, 'organizer');

    const user = await pool.query('SELECT clerk_user_id FROM users WHERE user_id = 1');
    assert.equal(user.rows[0].clerk_user_id, 'clerk_real');
    const audit = await pool.query(`SELECT 1 FROM audit_logs WHERE action = 'link_clerk_account_by_email' AND entity_id = '1'`);
    assert.equal(audit.rows.length, 1);
  });

  await t.test('an inactive account is refused and not relinked', async () => {
    clerkUsers.set('clerk_off', verified('off@x.test'));
    const { status, body } = await signIn({ userId: 'clerk_off' });
    assert.equal(status, 403);
    assert.equal(body.error.code, 'PROJECT_ACCESS_DENIED');
    const { rows } = await pool.query('SELECT clerk_user_id FROM users WHERE user_id = 3');
    assert.equal(rows[0].clerk_user_id, 'clerk_old_off');
  });
});
