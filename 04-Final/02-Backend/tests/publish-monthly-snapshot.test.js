
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  publishMonthlySnapshot
} = require('../dist/phase2/rankings/publish-monthly-snapshot.js');

const candidate = {
  userId: 5,
  rankingScope: 'Team',
  teamId: 2,
  campusId: 1,
  year: 2026,
  month: 9,
  totalPoints: 80,
  rankPosition: 1
};

function setup(options = {}) {
  const calls = [];
  let released = false;

  const client = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });

      if (sql.includes('SELECT role, is_active')) {
        return {
          rows: options.forbidden
            ? [{ role: 'Member', is_active: true }]
            : [{ role: 'Organizer', is_active: true }]
        };
      }

      if (sql.includes('FROM audit_logs')) {
        return { rows: options.published ? [{ '?column?': 1 }] : [] };
      }

      if (sql.includes('FROM monthly_rankings')) {
        return { rows: options.existing ? [{ '?column?': 1 }] : [] };
      }

      if (sql.includes('INSERT INTO monthly_rankings') &&
          options.insertFailure) {
        throw new Error('Simulated insert failure');
      }

      return { rows: [] };
    },
    release: () => {
      released = true;
    }
  };

  const pool = {
    connect: async () => client
  };

  const preview = async () => {
    if (options.previewFailure) {
      throw new Error('Preview failed');
    }

    const candidates = options.empty ? [] : [candidate];

    return {
      year: 2026,
      month: 9,
      candidates,
      conflicts: options.conflicts ? [{ userId: 5 }] : [],
      hasConflicts: !!options.conflicts,
      emptyMonth: candidates.length === 0
    };
  };

  return {
    pool,
    preview,
    calls,
    get released() {
      return released;
    }
  };
}

function called(mock, fragment) {
  return mock.calls.some(({ sql }) => sql.includes(fragment));
}

test('publishes valid rankings and commits', async () => {
  const mock = setup();

  const result = await publishMonthlySnapshot(
    mock.pool, 2026, 9, 10, mock.preview
  );

  assert.equal(result.published, true);
  assert.equal(result.rowCount, 1);
  assert.ok(called(mock, 'INSERT INTO monthly_rankings'));
  assert.ok(called(mock, 'INSERT INTO audit_logs'));
  assert.ok(called(mock, 'COMMIT'));
  assert.equal(mock.released, true);
});

test('records an empty month without ranking inserts', async () => {
  const mock = setup({ empty: true });

  const result = await publishMonthlySnapshot(
    mock.pool, 2026, 9, 10, mock.preview
  );

  assert.equal(result.emptyMonth, true);
  assert.equal(result.rowCount, 0);
  assert.equal(called(mock, 'INSERT INTO monthly_rankings'), false);
  assert.ok(called(mock, 'INSERT INTO audit_logs'));
  assert.ok(called(mock, 'COMMIT'));
});

test('rejects duplicate publication', async () => {
  const mock = setup({ published: true });

  await assert.rejects(
    publishMonthlySnapshot(mock.pool, 2026, 9, 10, mock.preview),
    /MONTH_ALREADY_PUBLISHED/
  );

  assert.ok(called(mock, 'ROLLBACK'));
  assert.equal(called(mock, 'COMMIT'), false);
});

test('rejects preexisting snapshot rows', async () => {
  const mock = setup({ existing: true });

  await assert.rejects(
    publishMonthlySnapshot(mock.pool, 2026, 9, 10, mock.preview),
    /EXISTING_SNAPSHOT_ROWS/
  );

  assert.ok(called(mock, 'ROLLBACK'));
});

test('rejects conflicting candidates', async () => {
  const mock = setup({ conflicts: true });

  await assert.rejects(
    publishMonthlySnapshot(mock.pool, 2026, 9, 10, mock.preview),
    /SNAPSHOT_CONFLICTS/
  );

  assert.equal(called(mock, 'INSERT INTO monthly_rankings'), false);
  assert.ok(called(mock, 'ROLLBACK'));
});

test('rejects unauthorized users', async () => {
  const mock = setup({ forbidden: true });

  await assert.rejects(
    publishMonthlySnapshot(mock.pool, 2026, 9, 10, mock.preview),
    /FORBIDDEN_SNAPSHOT_PUBLICATION/
  );

  assert.ok(called(mock, 'ROLLBACK'));
});

test('rolls back when an insert fails', async () => {
  const mock = setup({ insertFailure: true });

  await assert.rejects(
    publishMonthlySnapshot(mock.pool, 2026, 9, 10, mock.preview),
    /Simulated insert failure/
  );

  assert.ok(called(mock, 'ROLLBACK'));
  assert.equal(called(mock, 'COMMIT'), false);
  assert.equal(mock.released, true);
});

test('rolls back when preview fails', async () => {
  const mock = setup({ previewFailure: true });

  await assert.rejects(
    publishMonthlySnapshot(mock.pool, 2026, 9, 10, mock.preview),
    /Preview failed/
  );

  assert.ok(called(mock, 'ROLLBACK'));
});

test('rejects invalid month before connecting', async () => {
  const mock = setup();

  await assert.rejects(
    publishMonthlySnapshot(mock.pool, 2026, 13, 10, mock.preview),
    /INVALID_SNAPSHOT_PERIOD/
  );

  assert.equal(mock.calls.length, 0);
});
