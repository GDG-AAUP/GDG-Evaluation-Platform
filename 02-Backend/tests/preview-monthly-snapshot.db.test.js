
const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../src/config/db');

const {
  previewMonthlySnapshot
} = require('../dist/phase2/rankings/preview-monthly-snapshot.js');

test('Monthly snapshot preview works with PostgreSQL', {
  timeout: 120000
}, async (t) => {
  t.after(async () => {
    await pool.end();
  });

  const before = await pool.query(
    'SELECT COUNT(*)::int AS count FROM monthly_rankings'
  );

  const result = await previewMonthlySnapshot(
    pool,
    2026,
    9
  );

  await t.test('returns the requested period', () => {
    assert.equal(result.year, 2026);
    assert.equal(result.month, 9);
  });

  await t.test('produces valid snapshot candidates', () => {
    assert.ok(Array.isArray(result.candidates));

    for (const row of result.candidates) {
      assert.ok(Number.isInteger(row.userId));
      assert.ok(row.userId > 0);

      assert.ok(['Team', 'Campus'].includes(
        row.rankingScope
      ));

      assert.ok(Number.isInteger(row.totalPoints));
      assert.ok(Number.isInteger(row.rankPosition));
      assert.ok(row.rankPosition >= 1);

      assert.equal(row.year, 2026);
      assert.equal(row.month, 9);

      if (row.rankingScope === 'Team') {
        assert.ok(Number.isInteger(row.teamId));
      } else {
        assert.equal(row.teamId, null);
      }
    }
  });

  await t.test('reports conflicts correctly', () => {
    assert.equal(
      result.hasConflicts,
      result.conflicts.length > 0
    );

    for (const conflict of result.conflicts) {
      assert.ok(conflict.rows.length > 1);

      for (const row of conflict.rows) {
        assert.equal(row.userId, conflict.userId);
        assert.equal(
          row.rankingScope,
          conflict.rankingScope
        );
        assert.equal(row.year, conflict.year);
        assert.equal(row.month, conflict.month);
      }
    }
  });

  await t.test('detects empty snapshots correctly', () => {
    assert.equal(
      result.emptyMonth,
      result.candidates.length === 0
    );
  });

  await t.test('does not modify monthly_rankings', async () => {
    const after = await pool.query(
      'SELECT COUNT(*)::int AS count FROM monthly_rankings'
    );

    assert.equal(
      after.rows[0].count,
      before.rows[0].count
    );
  });

  console.log('Snapshot preview:', {
    candidates: result.candidates.length,
    conflicts: result.conflicts.length,
    emptyMonth: result.emptyMonth
  });
});
