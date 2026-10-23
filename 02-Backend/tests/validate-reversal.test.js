
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  parsePointEntryId,
  validateReversePoint
} = require('../dist/phase2/points/validate-reversal.js')

// Entry ID tests

test('accepts valid point entry IDs', () => {
  assert.equal(parsePointEntryId('1'), '1')
  assert.equal(parsePointEntryId('42'), '42')
  assert.equal(
    parsePointEntryId('9223372036854775807'),
    '9223372036854775807'
  )
})

test('rejects zero and negative IDs', () => {
  assert.equal(parsePointEntryId('0'), null)
  assert.equal(parsePointEntryId('-5'), null)
})

test('rejects noninteger ID formats', () => {
  assert.equal(parsePointEntryId('2.5'), null)
  assert.equal(parsePointEntryId('abc'), null)
  assert.equal(parsePointEntryId('01'), null)
  assert.equal(parsePointEntryId(' 42 '), null)
})

test('rejects nonstring IDs', () => {
  assert.equal(parsePointEntryId(42), null)
  assert.equal(parsePointEntryId(null), null)
  assert.equal(parsePointEntryId(undefined), null)
})

test('rejects IDs larger than PostgreSQL BIGINT', () => {
  assert.equal(
    parsePointEntryId('9223372036854775808'),
    null
  )
})

// Reversal body tests

test('accepts a valid reversal reason', () => {
  assert.deepEqual(
    validateReversePoint({
      reason: 'Awarded by mistake'
    }),
    {
      value: {
        reason: 'Awarded by mistake'
      }
    }
  )
})

test('trims reversal reasons', () => {
  assert.deepEqual(
    validateReversePoint({
      reason: '  Incorrect award  '
    }),
    {
      value: {
        reason: 'Incorrect award'
      }
    }
  )
})

test('rejects missing reversal reasons', () => {
  assert.ok(validateReversePoint({}).error)
})

test('rejects empty reversal reasons', () => {
  assert.ok(validateReversePoint({ reason: '' }).error)
  assert.ok(validateReversePoint({ reason: '   ' }).error)
})

test('rejects nonstring reversal reasons', () => {
  assert.ok(validateReversePoint({ reason: 123 }).error)
  assert.ok(validateReversePoint({ reason: null }).error)
})

test('rejects unexpected request fields', () => {
  assert.ok(
    validateReversePoint({
      reason: 'Correction',
      points: 100
    }).error
  )

  assert.ok(
    validateReversePoint({
      reason: 'Correction',
      performedByUserId: 1
    }).error
  )
})

test('rejects invalid request bodies', () => {
  assert.ok(validateReversePoint(null).error)
  assert.ok(validateReversePoint([]).error)
  assert.ok(validateReversePoint('Correction').error)
})

test('enforces the 500-character reason limit', () => {
  assert.ok(
    validateReversePoint({
      reason: 'a'.repeat(501)
    }).error
  )

  assert.deepEqual(
    validateReversePoint({
      reason: 'a'.repeat(500)
    }),
    {
      value: {
        reason: 'a'.repeat(500)
      }
    }
  )
})
