
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validatePerformanceEvaluation,
  calculateManagerEvaluationScore,
  MANAGER_EVALUATION_CRITERIA
} = require('../dist/phase2/evaluations/validate-performance-evaluation.js');

function valid(overrides = {}) {
  return {
    evaluatedUserId: 5,
    activityName: 'Technical Workshop',
    activityDate: '2026-10-20',
    criteriaScores: [85, 80, 90, 75],
    comments: 'Good performance',
    ...overrides
  };
}

function invalid(body) {
  return 'error' in validatePerformanceEvaluation(body);
}

test('defines the four approved criteria', () => {
  assert.equal(MANAGER_EVALUATION_CRITERIA.length, 4);

  assert.deepEqual(
    MANAGER_EVALUATION_CRITERIA.map(c => c.weight),
    [30, 30, 20, 20]
  );
});

test('calculates the first frontend example', () => {
  assert.equal(
    calculateManagerEvaluationScore([85, 80, 90, 75]),
    83
  );
});

test('calculates the second frontend example', () => {
  assert.equal(
    calculateManagerEvaluationScore([70, 65, 80, 60]),
    69
  );
});

test('accepts valid four-criterion evaluation', () => {
  const result = validatePerformanceEvaluation(valid());

  assert.equal(result.value.criteriaTotalScore, 83);
  assert.deepEqual(
    result.value.criteriaScores,
    [85, 80, 90, 75]
  );
});

test('accepts zero scores', () => {
  const result = validatePerformanceEvaluation(
    valid({ criteriaScores: [0, 0, 0, 0] })
  );

  assert.equal(result.value.criteriaTotalScore, 0);
});

test('accepts maximum scores', () => {
  const result = validatePerformanceEvaluation(
    valid({ criteriaScores: [100, 100, 100, 100] })
  );

  assert.equal(result.value.criteriaTotalScore, 100);
});

test('rejects missing scores', () => {
  assert.equal(
    invalid(valid({ criteriaScores: undefined })),
    true
  );
});

test('rejects fewer than four scores', () => {
  assert.equal(
    invalid(valid({ criteriaScores: [80, 90, 70] })),
    true
  );
});

test('rejects more than four scores', () => {
  assert.equal(
    invalid(valid({ criteriaScores: [80, 90, 70, 60, 50] })),
    true
  );
});

test('rejects negative scores', () => {
  assert.equal(
    invalid(valid({ criteriaScores: [-1, 80, 90, 70] })),
    true
  );
});

test('rejects scores above 100', () => {
  assert.equal(
    invalid(valid({ criteriaScores: [101, 80, 90, 70] })),
    true
  );
});

test('rejects fractional scores', () => {
  assert.equal(
    invalid(valid({ criteriaScores: [85.5, 80, 90, 70] })),
    true
  );
});

test('rejects nonnumeric scores', () => {
  assert.equal(
    invalid(valid({ criteriaScores: ['85', 80, 90, 70] })),
    true
  );
});

test('rejects invalid user IDs', () => {
  assert.equal(
    invalid(valid({ evaluatedUserId: -5 })),
    true
  );
});

test('rejects empty activity names', () => {
  assert.equal(
    invalid(valid({ activityName: '   ' })),
    true
  );
});

test('rejects invalid calendar dates', () => {
  assert.equal(
    invalid(valid({ activityDate: '2026-02-30' })),
    true
  );
});

test('trims activity names and comments', () => {
  const result = validatePerformanceEvaluation(
    valid({
      activityName: '  Workshop  ',
      comments: '  Excellent  '
    })
  );

  assert.equal(result.value.activityName, 'Workshop');
  assert.equal(result.value.comments, 'Excellent');
});

test('rejects client-supplied total and evaluator', () => {
  assert.equal(
    invalid(valid({
      criteriaTotalScore: 100,
      evaluatedByUserId: 10
    })),
    true
  );
});

test('rejects the old 15-criterion format', () => {
  assert.equal(
    invalid(valid({ criteriaScores: Array(15).fill(5) })),
    true
  );
});

test('rejects invalid scores in direct calculation', () => {
  assert.throws(
    () => calculateManagerEvaluationScore([120, 80, 70, 60]),
    RangeError
  );
});
