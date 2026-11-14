
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getManagerMonthlyAverage
} = require('../dist/phase2/evaluations/get-manager-monthly-average.js');

function mockPool(rows = []) {
  const calls = [];

  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows };
    }
  };
}

function managerRow(count, average) {
  return {
    role: 'Manager',
    evaluationCount: count,
    averageScore: average
  };
}

test('Calculates the average of two evaluations', async () => {
  const pool = mockPool([managerRow(2, '76.00')]);

  const result = await getManagerMonthlyAverage(
    pool, 5, 2026, 10
  );

  assert.deepEqual(result, {
    outcome: 'found',
    managerUserId: 5,
    year: 2026,
    month: 10,
    evaluationCount: 2,
    averageScore: 76
  });
});

test('Returns a single evaluation score', async () => {
  const pool = mockPool([managerRow(1, '83.00')]);

  const result = await getManagerMonthlyAverage(
    pool, 5, 2026, 10
  );

  assert.equal(result.averageScore, 83);
  assert.equal(result.evaluationCount, 1);
});

test('Preserves fractional monthly averages', async () => {
  const pool = mockPool([managerRow(2, '82.50')]);

  const result = await getManagerMonthlyAverage(
    pool, 5, 2026, 10
  );

  assert.equal(result.averageScore, 82.5);
});

test('Returns null when the Manager has no evaluations', async () => {
  const pool = mockPool([managerRow(0, null)]);

  const result = await getManagerMonthlyAverage(
    pool, 5, 2026, 10
  );

  assert.equal(result.outcome, 'found');
  assert.equal(result.evaluationCount, 0);
  assert.equal(result.averageScore, null);
});

test('Returns not_found for a missing user', async () => {
  const pool = mockPool([]);

  const result = await getManagerMonthlyAverage(
    pool, 999, 2026, 10
  );

  assert.deepEqual(result, {
    outcome: 'not_found'
  });
});

test('Rejects Members as Manager evaluation targets', async () => {
  const pool = mockPool([{
    role: 'Member',
    evaluationCount: 0,
    averageScore: null
  }]);

  const result = await getManagerMonthlyAverage(
    pool, 11, 2026, 10
  );

  assert.deepEqual(result, {
    outcome: 'not_manager'
  });
});

test('Rejects Organizers as Manager evaluation targets', async () => {
  const pool = mockPool([{
    role: 'Organizer',
    evaluationCount: 0,
    averageScore: null
  }]);

  const result = await getManagerMonthlyAverage(
    pool, 10, 2026, 10
  );

  assert.equal(result.outcome, 'not_manager');
});

test('Passes manager, year and month as SQL parameters', async () => {
  const pool = mockPool([managerRow(0, null)]);

  await getManagerMonthlyAverage(
    pool, 42, 2026, 12
  );

  assert.deepEqual(
    pool.calls[0].params,
    [42, 2026, 12]
  );
});

test('Filters evaluations using activity_date', async () => {
  const pool = mockPool([managerRow(0, null)]);

  await getManagerMonthlyAverage(
    pool, 5, 2026, 10
  );

  const sql = pool.calls[0].sql;

  assert.match(sql, /e\.activity_date\s*>=/);
  assert.match(sql, /e\.activity_date\s*</);
  assert.match(sql, /MAKE_DATE/);
});

test('Counts only actual evaluation rows', async () => {
  const pool = mockPool([managerRow(0, null)]);

  await getManagerMonthlyAverage(
    pool, 5, 2026, 10
  );

  assert.match(
    pool.calls[0].sql,
    /COUNT\(e\.evaluation_id\)/
  );
});

test('Reads Manager Evaluations without using member points', async () => {
  const pool = mockPool([managerRow(2, '76.00')]);

  await getManagerMonthlyAverage(
    pool, 5, 2026, 10
  );

  const sql = pool.calls[0].sql;

  assert.match(sql, /performance_evaluations/);
  assert.doesNotMatch(sql, /point_entries/);
  assert.doesNotMatch(sql, /monthly_rankings/);
});

test('Rejects invalid Manager IDs before querying', async () => {
  const pool = mockPool();

  for (const id of [0, -1, 1.5, NaN, 2147483648]) {
    await assert.rejects(
      getManagerMonthlyAverage(pool, id, 2026, 10),
      RangeError
    );
  }

  assert.equal(pool.calls.length, 0);
});

test('Rejects invalid months before querying', async () => {
  const pool = mockPool();

  for (const month of [0, 13, 1.5, NaN]) {
    await assert.rejects(
      getManagerMonthlyAverage(pool, 5, 2026, month),
      RangeError
    );
  }

  assert.equal(pool.calls.length, 0);
});

test('Rejects invalid years before querying', async () => {
  const pool = mockPool();

  for (const year of [1999, 10000, 2026.5, NaN]) {
    await assert.rejects(
      getManagerMonthlyAverage(pool, 5, year, 10),
      RangeError
    );
  }

  assert.equal(pool.calls.length, 0);
});

test('Propagates database errors', async () => {
  const pool = {
    query: async () => {
      throw new Error('Database unavailable');
    }
  };

  await assert.rejects(
    getManagerMonthlyAverage(pool, 5, 2026, 10),
    /Database unavailable/
  );
});
