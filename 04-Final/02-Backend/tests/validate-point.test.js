
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  validateCreatePoint
} = require('../dist/phase2/points/validate-point.js')

const validPoint = {
  userId: 7,
  points: 20,
  activityName: 'Workshop',
  reason: 'Participation'
}

test('accepts and normalizes a valid request', () => {
  const result = validateCreatePoint({
    ...validPoint,
    activityName: '  Workshop  ',
    reason: '  Participation  ',
    activityDescription: '  Helped organize  '
  })

  assert.deepEqual(result.value, {
    userId: 7,
    points: 20,
    activityName: 'Workshop',
    reason: 'Participation',
    activityDescription: 'Helped organize'
  })
})

test('accepts an omitted description', () => {
  const result = validateCreatePoint(validPoint)
  assert.equal(result.value?.activityDescription, null)
})

test('accepts null or blank descriptions', () => {
  for (const description of [null, '   ']) {
    const result = validateCreatePoint({
      ...validPoint,
      activityDescription: description
    })

    assert.equal(result.value?.activityDescription, null)
  }
})

test('accepts the point boundaries', () => {
  for (const points of [-100, -1, 1, 100]) {
    const result = validateCreatePoint({
      ...validPoint,
      points
    })

    assert.equal(result.value?.points, points)
  }
})

const invalidCases = [
  ['null body', null],
  ['array body', []],
  ['unexpected field', { ...validPoint, performedByUserId: 5 }],
  ['zero user ID', { ...validPoint, userId: 0 }],
  ['decimal user ID', { ...validPoint, userId: 1.5 }],
  ['user ID exceeds PostgreSQL integer', { ...validPoint, userId: 2147483648 }],
  ['zero points', { ...validPoint, points: 0 }],
  ['points above maximum', { ...validPoint, points: 101 }],
  ['points below minimum', { ...validPoint, points: -101 }],
  ['decimal points', { ...validPoint, points: 12.5 }],
  ['string points', { ...validPoint, points: '20' }],
  ['blank activity', { ...validPoint, activityName: '   ' }],
  ['activity too long', { ...validPoint, activityName: 'A'.repeat(101) }],
  ['blank reason', { ...validPoint, reason: '   ' }],
  ['numeric description', { ...validPoint, activityDescription: 42 }]
]

for (const [name, input] of invalidCases) {
  test(`rejects ${name}`, () => {
    const result = validateCreatePoint(input)

    assert.equal(typeof result.error, 'string')
    assert.equal(result.value, undefined)
  })
}
