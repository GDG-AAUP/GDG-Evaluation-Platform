

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  checkPointRecipient
} = require('../dist/phase2/points/check-recipient.js')

const manager = {
  id: 5,
  role: 'manager',
  teamId: 2
}

const organizer = {
  id: 1,
  role: 'organizer',
  teamId: null
}

const validRecipient = {
  userId: 7,
  role: 'member',
  teamId: 2,
  isActive: true,
  deletedAt: null,
  managerId: 5
}

const scenarios = [
  {
    name: 'Manager can award points to own team member',
    actor: manager,
    recipient: validRecipient,
    expected: 'allowed'
  },
  {
    name: 'Manager cannot award points to another team',
    actor: manager,
    recipient: { ...validRecipient, managerId: 9 },
    expected: 'forbidden'
  },
  {
    name: 'Organizer can award points across teams',
    actor: organizer,
    recipient: { ...validRecipient, managerId: 9 },
    expected: 'allowed'
  },
  {
    name: 'Missing recipient is not found',
    actor: manager,
    recipient: null,
    expected: 'not_found'
  },
  {
    name: 'Inactive member is rejected',
    actor: manager,
    recipient: { ...validRecipient, isActive: false },
    expected: 'forbidden'
  },
  {
    name: 'Deleted member is rejected',
    actor: manager,
    recipient: {
      ...validRecipient,
      deletedAt: new Date()
    },
    expected: 'forbidden'
  },
  {
    name: 'Non-member recipient is rejected',
    actor: manager,
    recipient: { ...validRecipient, role: 'manager' },
    expected: 'forbidden'
  },
  {
    name: 'Recipient without a team is rejected',
    actor: organizer,
    recipient: { ...validRecipient, teamId: null },
    expected: 'forbidden'
  },
  {
    name: 'Self-awarding is rejected',
    actor: { ...manager, id: 7 },
    recipient: { ...validRecipient, userId: 7 },
    expected: 'forbidden'
  }
]

for (const scenario of scenarios) {
  test(scenario.name, async () => {
    let queryCount = 0

    const fakeClient = {
      query: async (sql, params) => {
        queryCount++

        assert.match(sql, /WHERE u\.user_id\s*=\s*\$1/i)
        assert.deepEqual(params, [7])

        return {
          rows: scenario.recipient
            ? [scenario.recipient]
            : []
        }
      }
    }

    const result = await checkPointRecipient(
      fakeClient,
      scenario.actor,
      7
    )

    assert.equal(result, scenario.expected)
    assert.equal(queryCount, 1)
  })
}
