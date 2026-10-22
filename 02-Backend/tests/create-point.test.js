
const test = require('node:test')
const assert = require('node:assert/strict')

const { createPoint } = require('../dist/phase2/points/create-point.js')

const actor = {
  id: 5,
  role: 'manager',
  teamId: 2
}

const input = {
  userId: 7,
  points: 20,
  activityName: 'Workshop',
  reason: 'Participation',
  activityDescription: null
}

const cases = [
  {
    name: 'missing actor',
    dbActor: null
  },
  {
    name: 'inactive actor',
    dbActor: {
      role: 'manager',
      isActive: false,
      deletedAt: null
    }
  },
  {
    name: 'deleted actor',
    dbActor: {
      role: 'manager',
      isActive: true,
      deletedAt: new Date()
    }
  },
  {
    name: 'actor changed to member',
    dbActor: {
      role: 'member',
      isActive: true,
      deletedAt: null
    }
  },
  {
    name: 'actor role changed',
    dbActor: {
      role: 'organizer',
      isActive: true,
      deletedAt: null
    }
  }
]

for (const scenario of cases) {
  test(`createPoint rejects ${scenario.name}`, async () => {
    const queries = []
    let released = false

    const client = {
      query: async (sql, params) => {
        queries.push(sql)

        if (/SELECT[\s\S]*FROM users/i.test(sql)) {
          assert.deepEqual(params, [5])

          return {
            rows: scenario.dbActor
              ? [scenario.dbActor]
              : []
          }
        }

        return { rows: [] }
      },

      release: () => {
        released = true
      }
    }

    const pool = {
      connect: async () => client
    }

    const result = await createPoint(pool, actor, input)

    assert.deepEqual(result, { outcome: 'forbidden' })
    assert.equal(released, true)

    assert.ok(queries.some(sql => sql.trim() === 'BEGIN'))
    assert.ok(queries.some(sql => sql.trim() === 'ROLLBACK'))
    assert.equal(
      queries.some(sql => /\bINSERT\b|\bCOMMIT\b/i.test(sql)),
      false
    )
  })
}

const recipientCases = [
  {
    name: 'recipient does not exist',
    recipient: null,
    expected: 'recipient_not_found'
  },
  {
    name: 'recipient belongs to another team',
    recipient: {
      userId: 7,
      role: 'member',
      teamId: 3,
      isActive: true,
      deletedAt: null,
      managerId: 9
    },
    expected: 'forbidden'
  },
  {
    name: 'recipient is inactive',
    recipient: {
      userId: 7,
      role: 'member',
      teamId: 2,
      isActive: false,
      deletedAt: null,
      managerId: 5
    },
    expected: 'forbidden'
  }
]

for (const scenario of recipientCases) {
  test(`createPoint rejects when ${scenario.name}`, async () => {
    const queries = []
    let released = false

    const client = {
      query: async (sql, params) => {
        queries.push(sql.trim())

        // Recipient lookup
        if (/FROM\s+users\s+u\b/i.test(sql)) {
          assert.deepEqual(params, [7])
          return {
            rows: scenario.recipient
              ? [scenario.recipient]
              : []
          }
        }

        // Authenticated actor lookup
        if (/FROM\s+users\s+WHERE/i.test(sql)) {
          assert.deepEqual(params, [5])
          return {
            rows: [{
              role: 'manager',
              isActive: true,
              deletedAt: null
            }]
          }
        }

        return { rows: [] }
      },

      release: () => {
        released = true
      }
    }

    const pool = {
      connect: async () => client
    }

    const result = await createPoint(pool, actor, input)

    assert.equal(result.outcome, scenario.expected)
    assert.equal(released, true)

    assert.ok(queries.includes('BEGIN'))
    assert.ok(queries.includes('ROLLBACK'))

    assert.equal(
      queries.some(sql => /\bINSERT\b|\bCOMMIT\b/i.test(sql)),
      false
    )
  })
}

function createSuccessfulTransactionMock(failAudit = false) {
  const queries = [];
  let released = false;

  const entry = {
    id: '42',
    userId: 7,
    performedByUserId: 5,
    points: 20,
    activityName: 'Workshop',
    reason: 'Participation',
    activityDescription: null,
    effectiveAt: '2026-10-22T12:00:00.000Z'
  };

  const client = {
    query: async (sql, params = []) => {
      const statement = sql.trim();
      queries.push({ sql: statement, params });

      // Check the authenticated actor.
      if (/FROM\s+users\s+WHERE/i.test(statement)) {
        return {
          rows: [{
            role: 'manager',
            isActive: true,
            deletedAt: null
          }]
        };
      }

      // Check the recipient and their team.
      if (/FROM\s+users\s+u\b/i.test(statement)) {
        return {
          rows: [{
            userId: 7,
            role: 'member',
            teamId: 2,
            isActive: true,
            deletedAt: null,
            managerId: 5
          }]
        };
      }

      // Simulate PostgreSQL inserting the point entry.
      if (/INSERT\s+INTO\s+point_entries/i.test(statement)) {
        return { rows: [entry] };
      }

      // Simulate the audit insert.
      if (/INSERT\s+INTO\s+audit_logs/i.test(statement)) {
        if (failAudit) {
          throw new Error('Simulated audit failure');
        }

        return { rows: [] };
      }

      return { rows: [] };
    },

    release: () => {
      released = true;
    }
  };

  return {
    pool: { connect: async () => client },
    queries,
    entry,
    wasReleased: () => released
  };
}

test('createPoint commits point and audit inserts together', async () => {
  const mock = createSuccessfulTransactionMock();

  const result = await createPoint(mock.pool, actor, input);

  assert.deepEqual(result, {
    outcome: 'created',
    entry: mock.entry
  });

  const pointInsert = mock.queries.find(
    q => /INSERT\s+INTO\s+point_entries/i.test(q.sql)
  );

  const auditInsert = mock.queries.find(
    q => /INSERT\s+INTO\s+audit_logs/i.test(q.sql)
  );

  assert.ok(pointInsert);
  assert.ok(auditInsert);

  assert.deepEqual(pointInsert.params, [
    7, 5, 20, 'Workshop', 'Participation', null
  ]);

  assert.deepEqual(auditInsert.params, [
    5,
    '42',
    JSON.stringify(mock.entry),
    'Participation'
  ]);

  const statements = mock.queries.map(q => q.sql);

  assert.ok(statements.includes('BEGIN'));
  assert.ok(statements.includes('COMMIT'));
  assert.equal(statements.includes('ROLLBACK'), false);
  assert.equal(mock.wasReleased(), true);
});

test('createPoint rolls back when the audit insert fails', async () => {
  const mock = createSuccessfulTransactionMock(true);

  await assert.rejects(
    createPoint(mock.pool, actor, input),
    /Simulated audit failure/
  );

  const statements = mock.queries.map(q => q.sql);

  assert.ok(
    statements.some(sql => /INSERT\s+INTO\s+point_entries/i.test(sql))
  );

  assert.ok(
    statements.some(sql => /INSERT\s+INTO\s+audit_logs/i.test(sql))
  );

  assert.ok(statements.includes('ROLLBACK'));
  assert.equal(statements.includes('COMMIT'), false);
  assert.equal(mock.wasReleased(), true);
});
