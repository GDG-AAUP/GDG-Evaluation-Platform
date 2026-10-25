
const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../src/config/db');

const {
  getAuditLogs
} = require('../dist/phase2/audit/get-audit-logs.js');

test('Audit logs work with real PostgreSQL', {
  timeout: 120000
}, async (t) => {
  const client = await pool.connect();
  let transactionStarted = false;

  const testPool = {
    query: (sql, params) => client.query(sql, params)
  };

  function read(filters = {}) {
    return getAuditLogs(testPool, {
      page: 1,
      pageSize: 25,
      ...filters
    });
  }

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    await client.query(
      'CREATE TEMP TABLE users (LIKE public.users INCLUDING ALL)'
    );

    await client.query(
      'CREATE TEMP TABLE audit_logs (LIKE public.audit_logs INCLUDING ALL)'
    );

    await client.query(
      'SET LOCAL search_path TO pg_temp, public'
    );

    await client.query(`
      INSERT INTO users (
        user_id, clerk_user_id, full_name,
        email, role, team_id
      ) VALUES
        (10, 'audit_test_10', 'Organizer A',
         'audit10@example.test', 'Organizer', NULL),
        (11, 'audit_test_11', 'Organizer B',
         'audit11@example.test', 'Organizer', NULL)
    `);

    await client.query(`
      INSERT INTO audit_logs (
        audit_id, actor_user_id, action,
        entity_name, entity_id,
        old_values, new_values, reason, created_at
      ) VALUES
        (9001, 10, 'POINT_CREATED',
         'point_entries', '100',
         '{"points":0}'::jsonb,
         '{"points":25}'::jsonb,
         'Workshop',
         '2026-10-05 10:00:00'),

        (9002, 11, 'POINT_REVERSED',
         'point_entries', '100',
         '{"points":25}'::jsonb,
         '{"points":0}'::jsonb,
         'Correction',
         '2026-10-06 12:00:00'),

        (9003, NULL, 'SYSTEM_EVENT',
         'system', '1',
         NULL,
         '{"status":"ok"}'::jsonb,
         'Automatic action',
         '2026-10-07 09:00:00')
    `);

    await t.test('returns audit records newest first', async () => {
      const result = await read();

      assert.equal(result.total, 3);
      assert.deepEqual(
        result.items.map(row => row.id),
        ['9003', '9002', '9001']
      );
    });

    await t.test('filters by actor', async () => {
      const result = await read({ actorId: 10 });

      assert.equal(result.total, 1);
      assert.equal(result.items[0].actorName, 'Organizer A');
    });

    await t.test('filters by action and entity', async () => {
      const result = await read({
        action: 'POINT_REVERSED',
        entityType: 'point_entries'
      });

      assert.equal(result.total, 1);
      assert.equal(result.items[0].id, '9002');
    });

    await t.test('filters dates inclusively', async () => {
      const result = await read({
        from: '2026-10-05',
        to: '2026-10-06'
      });

      assert.equal(result.total, 2);
      assert.deepEqual(
        result.items.map(row => row.id),
        ['9002', '9001']
      );
    });

    await t.test('supports pagination', async () => {
      const result = await read({
        page: 2,
        pageSize: 1
      });

      assert.equal(result.total, 3);
      assert.equal(result.page, 2);
      assert.equal(result.pageSize, 1);
      assert.equal(result.items[0].id, '9002');
    });

    await t.test('preserves JSON audit values', async () => {
      const result = await read({ actorId: 10 });

      assert.deepEqual(
        result.items[0].oldValues,
        { points: 0 }
      );

      assert.deepEqual(
        result.items[0].newValues,
        { points: 25 }
      );
    });

    await t.test('handles null actor references', async () => {
      const result = await read({
        action: 'SYSTEM_EVENT'
      });

      assert.equal(result.total, 1);
      assert.equal(result.items[0].actorId, null);
      assert.equal(result.items[0].actorName, null);
    });

    await t.test('returns empty results when no records match', async () => {
      const result = await read({
        action: 'DOES_NOT_EXIST'
      });

      assert.equal(result.total, 0);
      assert.deepEqual(result.items, []);
    });

    await t.test('does not modify audit records', async () => {
      const result = await client.query(
        'SELECT COUNT(*)::int AS count FROM audit_logs'
      );

      assert.equal(result.rows[0].count, 3);
    });

  } finally {
    try {
      if (transactionStarted) {
        await client.query('ROLLBACK');
      }
    } finally {
      client.release();
      await pool.end();
    }
  }
});
