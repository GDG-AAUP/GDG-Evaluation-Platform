
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateRankingQuery
} = require('../dist/phase2/rankings/validate-ranking.js');

const validTeam = {
  scope: 'team',
  teamId: '2',
  year: '2026',
  month: '10'
};

const validCampus = {
  scope: 'campus',
  campusId: '1',
  year: '2026',
  month: '10'
};

function expectInvalid(input) {
  const result = validateRankingQuery(input);
  assert.equal(typeof result.error, 'string');
  assert.ok(result.error.length > 0);
}

// 1. Valid queries

test('accepts a valid Team ranking query', () => {
  assert.deepEqual(
    validateRankingQuery(validTeam),
    {
      value: {
        scope: 'Team',
        teamId: 2,
        campusId: null,
        year: 2026,
        month: 10
      }
    }
  );
});

test('accepts a valid Campus ranking query', () => {
  assert.deepEqual(
    validateRankingQuery(validCampus),
    {
      value: {
        scope: 'Campus',
        teamId: null,
        campusId: 1,
        year: 2026,
        month: 10
      }
    }
  );
});

test('accepts a zero-padded month', () => {
  assert.deepEqual(
    validateRankingQuery({
      ...validTeam,
      month: '02'
    }),
    {
      value: {
        scope: 'Team',
        teamId: 2,
        campusId: null,
        year: 2026,
        month: 2
      }
    }
  );
});

// 2. Scope validation

test('rejects a missing scope', () => {
  const { scope, ...query } = validTeam;
  expectInvalid(query);
});

test('rejects invalid ranking scopes', () => {
  expectInvalid({ ...validTeam, scope: 'global' });
  expectInvalid({ ...validTeam, scope: 'member' });
  expectInvalid({ ...validTeam, scope: '' });
});

// 3. Year and month validation

test('rejects missing year or month', () => {
  const { year, ...noYear } = validTeam;
  const { month, ...noMonth } = validTeam;

  expectInvalid(noYear);
  expectInvalid(noMonth);
});

test('rejects invalid years', () => {
  for (const year of [
    '1999',
    '10000',
    'abc',
    '2026.5',
    '',
    '026'
  ]) {
    expectInvalid({ ...validTeam, year });
  }
});

test('rejects invalid months', () => {
  for (const month of [
    '0',
    '13',
    '-1',
    '2.5',
    'abc',
    '',
    '000'
  ]) {
    expectInvalid({ ...validTeam, month });
  }
});

// 4. Team and Campus identifiers

test('rejects missing Team ID', () => {
  const { teamId, ...query } = validTeam;
  expectInvalid(query);
});

test('rejects missing Campus ID', () => {
  const { campusId, ...query } = validCampus;
  expectInvalid(query);
});

test('rejects invalid Team IDs', () => {
  for (const teamId of [
    '0',
    '-2',
    '1.5',
    'abc',
    '2147483648'
  ]) {
    expectInvalid({ ...validTeam, teamId });
  }
});

test('rejects invalid Campus IDs', () => {
  for (const campusId of [
    '0',
    '-1',
    'abc',
    '2147483648'
  ]) {
    expectInvalid({ ...validCampus, campusId });
  }
});

test('accepts the maximum PostgreSQL INT ID', () => {
  const result = validateRankingQuery({
    ...validTeam,
    teamId: '2147483647'
  });

  assert.equal(result.value.teamId, 2147483647);
});

test('rejects conflicting Team and Campus IDs', () => {
  expectInvalid({
    ...validTeam,
    campusId: '1'
  });

  expectInvalid({
    ...validCampus,
    teamId: '2'
  });
});

// 5. Request safety

test('rejects unexpected query fields', () => {
  expectInvalid({
    ...validTeam,
    userId: '5'
  });

  expectInvalid({
    ...validCampus,
    role: 'organizer'
  });
});

test('rejects nonstring and repeated query values', () => {
  expectInvalid({ ...validTeam, month: 10 });
  expectInvalid({ ...validTeam, teamId: ['1', '2'] });
  expectInvalid({ ...validTeam, scope: ['team'] });
  expectInvalid({ ...validTeam, year: null });
});

test('rejects invalid query objects', () => {
  expectInvalid(null);
  expectInvalid(undefined);
  expectInvalid([]);
  expectInvalid('team');
  expectInvalid(123);
});
