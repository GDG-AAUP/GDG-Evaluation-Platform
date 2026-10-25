
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildMonthlySnapshotPreview
} = require('../dist/phase2/rankings/preview-monthly-snapshot.js');

function createSource({
  teams = [{ id: 2, campusId: 1 }],
  campuses = [{ id: 1 }],
  teamRows = {},
  campusRows = {}
} = {}) {
  return {
    teams,
    campuses,

    teamRanking: async (id) => teamRows[id] || [],
    campusRanking: async (id) => campusRows[id] || []
  };
}

const alice = {
  userId: 5,
  rank: 1,
  totalPoints: 80
};

const bea = {
  userId: 6,
  rank: 2,
  totalPoints: 30
};

test('creates a Team snapshot', async () => {
  const source = createSource({
    teamRows: { 2: [alice] }
  });

  const result = await buildMonthlySnapshotPreview(
    source, 2026, 10
  );

  assert.deepEqual(result.candidates[0], {
    userId: 5,
    rankingScope: 'Team',
    teamId: 2,
    campusId: 1,
    year: 2026,
    month: 10,
    totalPoints: 80,
    rankPosition: 1
  });
});

test('creates a Campus snapshot', async () => {
  const source = createSource({
    campusRows: { 1: [alice] }
  });

  const result = await buildMonthlySnapshotPreview(
    source, 2026, 10
  );

  assert.deepEqual(result.candidates[0], {
    userId: 5,
    rankingScope: 'Campus',
    teamId: null,
    campusId: 1,
    year: 2026,
    month: 10,
    totalPoints: 80,
    rankPosition: 1
  });
});

test('allows same user in Team and Campus', async () => {
  const source = createSource({
    teamRows: { 2: [alice] },
    campusRows: { 1: [alice] }
  });

  const result = await buildMonthlySnapshotPreview(
    source, 2026, 10
  );

  assert.equal(result.candidates.length, 2);
  assert.equal(result.hasConflicts, false);
});

test('detects a member transferred between Teams', async () => {
  const source = createSource({
    teams: [
      { id: 2, campusId: 1 },
      { id: 3, campusId: 1 }
    ],
    teamRows: {
      2: [alice],
      3: [{ ...alice, totalPoints: 20 }]
    }
  });

  const result = await buildMonthlySnapshotPreview(
    source, 2026, 10
  );

  assert.equal(result.hasConflicts, true);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].userId, 5);
});

test('preserves signed point totals and ranks', async () => {
  const source = createSource({
    teamRows: {
      2: [
        alice,
        { ...bea, totalPoints: -10 }
      ]
    }
  });

  const result = await buildMonthlySnapshotPreview(
    source, 2026, 10
  );

  assert.deepEqual(
    result.candidates.map(row => row.totalPoints),
    [80, -10]
  );

  assert.deepEqual(
    result.candidates.map(row => row.rankPosition),
    [1, 2]
  );
});

test('detects empty months', async () => {
  const result = await buildMonthlySnapshotPreview(
    createSource(),
    2026,
    10
  );

  assert.deepEqual(result.candidates, []);
  assert.equal(result.emptyMonth, true);
  assert.equal(result.hasConflicts, false);
});

test('rejects invalid months', async () => {
  await assert.rejects(
    buildMonthlySnapshotPreview(
      createSource(), 2026, 13
    ),
    RangeError
  );
});

test('rejects invalid years', async () => {
  await assert.rejects(
    buildMonthlySnapshotPreview(
      createSource(), 1999, 10
    ),
    RangeError
  );
});

test('keeps different users separate', async () => {
  const source = createSource({
    teamRows: {
      2: [alice, bea]
    },
    campusRows: {
      1: [alice, bea]
    }
  });

  const result = await buildMonthlySnapshotPreview(
    source, 2026, 10
  );

  assert.equal(result.candidates.length, 4);
  assert.equal(result.conflicts.length, 0);
});
