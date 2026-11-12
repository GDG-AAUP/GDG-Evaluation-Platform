
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findSnapshotConflicts
} = require('../dist/phase2/rankings/find-snapshot-conflicts.js');

const base = {
  userId: 5,
  rankingScope: 'Team',
  teamId: 2,
  campusId: 1,
  year: 2026,
  month: 10,
  totalPoints: 40,
  rankPosition: 1
};

test('returns no conflicts for an empty snapshot', () => {
  assert.deepEqual(findSnapshotConflicts([]), []);
});

test('returns no conflicts for unique users', () => {
  const rows = [
    base,
    { ...base, userId: 6 }
  ];

  assert.deepEqual(findSnapshotConflicts(rows), []);
});

test('allows the same user in Team and Campus rankings', () => {
  const rows = [
    base,
    {
      ...base,
      rankingScope: 'Campus',
      teamId: null
    }
  ];

  assert.deepEqual(findSnapshotConflicts(rows), []);
});

test('allows a transferred user in two Teams in one month', () => {
  const rows = [
    base,
    { ...base, teamId: 3, totalPoints: 20 }
  ];

  assert.deepEqual(findSnapshotConflicts(rows), []);
});

test('allows a transferred user in two Campuses in one month', () => {
  const rows = [
    { ...base, rankingScope: 'Campus', teamId: null },
    { ...base, rankingScope: 'Campus', teamId: null, campusId: 2 }
  ];

  assert.deepEqual(findSnapshotConflicts(rows), []);
});

test('detects duplicate Campus snapshots for one user', () => {
  const rows = [
    { ...base, rankingScope: 'Campus', teamId: null },
    { ...base, rankingScope: 'Campus', teamId: null }
  ];

  const conflicts = findSnapshotConflicts(rows);

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].rankingScope, 'Campus');
  assert.equal(conflicts[0].month, 10);
  assert.equal(conflicts[0].year, 2026);
  assert.equal(conflicts[0].rows.length, 2);
});

test('allows the same user in different months', () => {
  const rows = [
    base,
    { ...base, month: 9 }
  ];

  assert.deepEqual(findSnapshotConflicts(rows), []);
});

test('allows the same user in different years', () => {
  const rows = [
    base,
    { ...base, year: 2025 }
  ];

  assert.deepEqual(findSnapshotConflicts(rows), []);
});

test('detects multiple independent conflicts', () => {
  const rows = [
    base,
    { ...base },
    { ...base, userId: 8 },
    { ...base, userId: 8 }
  ];

  const conflicts = findSnapshotConflicts(rows);

  assert.equal(conflicts.length, 2);

  assert.deepEqual(
    conflicts.map(c => c.userId),
    [5, 8]
  );
});

test('detects duplicate rows even within the same Team', () => {
  const rows = [
    base,
    { ...base }
  ];

  const conflicts = findSnapshotConflicts(rows);

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].rows.length, 2);
});
