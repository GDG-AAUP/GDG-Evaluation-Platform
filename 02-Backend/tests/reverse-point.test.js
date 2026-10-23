
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  reversePoint
} = require('../dist/phase2/points/reverse-point.js');

const actor = {
  id: 5,
  role: 'manager',
  teamId: 2
};

const organizer = {
  id: 1,
  role: 'organizer',
  teamId: null
};

const original = {
  id: '42',
  userId: 7,
  points: 20,
  activityName: 'Workshop',
  activityDescription: null,
  reversesEntryId: null
};

const validRecipient = {
  userId: 7,
  role: 'member',
  teamId: 2,
  isActive: true,
  deletedAt: null,
  managerId: 5
};

function createMock({
  dbActor = {
    role: 'manager',
    isActive: true,
    deletedAt: null
  },
  entry = original,
  recipient = validRecipient,
  existingReversal = null,
  failAudit = false,
  failInsert = false
} = {}) {
  const queries = [];
  let released = false;
  let savedReversal = null;

  const client = {
    query: async (sql, params = []) => {
      const statement = sql.trim();

      queries.push({
        sql: statement,
        params
      });

      if (/FROM\s+users\s+u\b/i.test(statement)) {
        return {
          rows: recipient ? [recipient] : []
        };
      }

      if (/FROM\s+users\b/i.test(statement)) {
        return {
          rows: dbActor ? [dbActor] : []
        };
      }

      if (/FROM\s+point_entries\b/i.test(statement)) {
        if (
          /WHERE\s+reverses_entry_id\s*=\s*\$1/i.test(statement)
        ) {
          return {
            rows: existingReversal
              ? [existingReversal]
              : []
          };
        }

        return {
          rows: entry ? [entry] : []
        };
      }

      if (/INSERT\s+INTO\s+point_entries\b/i.test(statement)) {
        if (failInsert) {
          throw new Error('Simulated point insert failure');
        }

        savedReversal = {
          id: '43',
          userId: params[0],
          performedByUserId: params[1],
          points: params[2],
          activityName: params[3],
          reason: params[4],
          activityDescription: params[5],
          reversesEntryId: String(params[6]),
          effectiveAt: '2026-10-23T14:00:00.000Z'
        };

        return {
          rows: [savedReversal]
        };
      }

      if (/INSERT\s+INTO\s+audit_logs\b/i.test(statement)) {
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
    pool: {
      connect: async () => client
    },
    queries,
    wasReleased: () => released,
    reversal: () => savedReversal
  };
}

async function assertRejected(mock, expected) {
  const result = await reversePoint(
    mock.pool,
    actor,
    '42',
    'Incorrect points'
  );

  assert.equal(result.outcome, expected);

  const statements = mock.queries.map(q => q.sql);

  assert.ok(statements.includes('BEGIN'));
  assert.ok(statements.includes('ROLLBACK'));

  assert.equal(
    statements.some(sql => /\bINSERT\b|\bCOMMIT\b/i.test(sql)),
    false
  );

  assert.equal(mock.wasReleased(), true);
}

// ---------------------------------------------
// Actor authorization
// ---------------------------------------------

test('rejects an actor missing from PostgreSQL', async () => {
  await assertRejected(
    createMock({ dbActor: null }),
    'forbidden'
  );
});

test('rejects an inactive actor', async () => {
  await assertRejected(
    createMock({
      dbActor: {
        role: 'manager',
        isActive: false,
        deletedAt: null
      }
    }),
    'forbidden'
  );
});

test('rejects an actor whose role changed', async () => {
  await assertRejected(
    createMock({
      dbActor: {
        role: 'member',
        isActive: true,
        deletedAt: null
      }
    }),
    'forbidden'
  );
});

test('rejects a deleted actor', async () => {
  await assertRejected(
    createMock({
      dbActor: {
        role: 'manager',
        isActive: true,
        deletedAt: '2026-10-23'
      }
    }),
    'forbidden'
  );
});

// ---------------------------------------------
// Original entry validation
// ---------------------------------------------

test('returns not found for a missing point entry', async () => {
  const mock = createMock({
    entry: null
  });

  await assertRejected(mock, 'entry_not_found');

  const lookup = mock.queries.find(
    q => /FROM\s+point_entries\b/i.test(q.sql)
  );

  assert.ok(lookup);
  assert.deepEqual(lookup.params, ['42']);
  assert.match(lookup.sql, /FOR\s+UPDATE/i);
});

test('prevents reversing an existing reversal entry', async () => {
  await assertRejected(
    createMock({
      entry: {
        ...original,
        reversesEntryId: '30'
      }
    }),
    'cannot_reverse_reversal'
  );
});

// ---------------------------------------------
// Recipient authorization
// ---------------------------------------------

test('rejects an original entry with a missing recipient', async () => {
  await assertRejected(
    createMock({ recipient: null }),
    'recipient_not_found'
  );
});

test('rejects a recipient assigned to another manager', async () => {
  await assertRejected(
    createMock({
      recipient: {
        ...validRecipient,
        teamId: 3,
        managerId: 9
      }
    }),
    'forbidden'
  );
});

test('rejects an inactive recipient', async () => {
  await assertRejected(
    createMock({
      recipient: {
        ...validRecipient,
        isActive: false
      }
    }),
    'forbidden'
  );
});

// ---------------------------------------------
// Duplicate reversal protection
// ---------------------------------------------

test('prevents reversing an entry twice', async () => {
  const mock = createMock({
    existingReversal: {
      id: '43'
    }
  });

  await assertRejected(mock, 'already_reversed');

  const lookup = mock.queries.find(
    q => /WHERE\s+reverses_entry_id\s*=\s*\$1/i.test(q.sql)
  );

  assert.ok(lookup);
  assert.deepEqual(lookup.params, ['42']);
});

// ---------------------------------------------
// Successful reversals
// ---------------------------------------------

test('reverses positive points and commits audit', async () => {
  const mock = createMock();

  const result = await reversePoint(
    mock.pool,
    actor,
    '42',
    'Incorrect points'
  );

  assert.equal(result.outcome, 'reversed');
  assert.deepEqual(result.entry, mock.reversal());

  assert.equal(result.entry.points, -20);
  assert.equal(result.entry.reversesEntryId, '42');

  const pointInsert = mock.queries.find(
    q => /INSERT\s+INTO\s+point_entries\b/i.test(q.sql)
  );

  const auditInsert = mock.queries.find(
    q => /INSERT\s+INTO\s+audit_logs\b/i.test(q.sql)
  );

  assert.ok(pointInsert);
  assert.ok(auditInsert);

  assert.deepEqual(pointInsert.params, [
    7,
    5,
    -20,
    'Workshop',
    'Incorrect points',
    null,
    '42'
  ]);

  assert.deepEqual(auditInsert.params, [
    5,
    '43',
    JSON.stringify(mock.reversal()),
    'Incorrect points'
  ]);

  const statements = mock.queries.map(q => q.sql);

  const pointIndex = statements.findIndex(
    sql => /INSERT\s+INTO\s+point_entries/i.test(sql)
  );

  const auditIndex = statements.findIndex(
    sql => /INSERT\s+INTO\s+audit_logs/i.test(sql)
  );

  const commitIndex = statements.indexOf('COMMIT');

  assert.ok(pointIndex >= 0);
  assert.ok(auditIndex > pointIndex);
  assert.ok(commitIndex > auditIndex);

  assert.equal(statements.includes('ROLLBACK'), false);
  assert.equal(mock.wasReleased(), true);
});

test('reverses negative points into positive points', async () => {
  const mock = createMock({
    entry: {
      ...original,
      points: -10
    }
  });

  const result = await reversePoint(
    mock.pool,
    actor,
    '42',
    'Incorrect deduction'
  );

  assert.equal(result.outcome, 'reversed');
  assert.equal(result.entry.points, 10);

  const pointInsert = mock.queries.find(
    q => /INSERT\s+INTO\s+point_entries\b/i.test(q.sql)
  );

  assert.ok(pointInsert);
  assert.equal(pointInsert.params[2], 10);
  assert.equal(pointInsert.params[4], 'Incorrect deduction');

  assert.ok(mock.queries.some(q => q.sql === 'COMMIT'));
  assert.equal(mock.wasReleased(), true);
});

test('allows organizers to reverse entries across teams', async () => {
  const mock = createMock({
    dbActor: {
      role: 'organizer',
      isActive: true,
      deletedAt: null
    },
    recipient: {
      ...validRecipient,
      teamId: 3,
      managerId: 9
    }
  });

  const result = await reversePoint(
    mock.pool,
    organizer,
    '42',
    'Organizer correction'
  );

  assert.equal(result.outcome, 'reversed');
  assert.equal(result.entry.performedByUserId, 1);

  const pointInsert = mock.queries.find(
    q => /INSERT\s+INTO\s+point_entries\b/i.test(q.sql)
  );

  assert.ok(pointInsert);
  assert.equal(pointInsert.params[1], 1);

  assert.ok(mock.queries.some(q => q.sql === 'COMMIT'));
  assert.equal(mock.wasReleased(), true);
});

// ---------------------------------------------
// Transaction failure handling
// ---------------------------------------------

test('rolls back reversal when audit insertion fails', async () => {
  const mock = createMock({
    failAudit: true
  });

  await assert.rejects(
    reversePoint(
      mock.pool,
      actor,
      '42',
      'Incorrect points'
    ),
    /Simulated audit failure/
  );

  const statements = mock.queries.map(q => q.sql);

  assert.ok(
    statements.some(
      sql => /INSERT\s+INTO\s+point_entries\b/i.test(sql)
    )
  );

  assert.ok(
    statements.some(
      sql => /INSERT\s+INTO\s+audit_logs\b/i.test(sql)
    )
  );

  assert.ok(statements.includes('ROLLBACK'));
  assert.equal(statements.includes('COMMIT'), false);
  assert.equal(mock.wasReleased(), true);
});

test('rolls back when reversal insertion fails', async () => {
  const mock = createMock({
    failInsert: true
  });

  await assert.rejects(
    reversePoint(
      mock.pool,
      actor,
      '42',
      'Incorrect points'
    ),
    /Simulated point insert failure/
  );

  const statements = mock.queries.map(q => q.sql);

  assert.ok(
    statements.some(
      sql => /INSERT\s+INTO\s+point_entries\b/i.test(sql)
    )
  );

  assert.equal(
    statements.some(
      sql => /INSERT\s+INTO\s+audit_logs\b/i.test(sql)
    ),
    false
  );

  assert.ok(statements.includes('ROLLBACK'));
  assert.equal(statements.includes('COMMIT'), false);
  assert.equal(mock.wasReleased(), true);
});
