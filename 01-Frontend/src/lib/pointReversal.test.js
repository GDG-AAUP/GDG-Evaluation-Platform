// "عكس العملية" in the Give Points log: when the button is offered, and what the confirmation submits.
// Run: node --test src/lib/pointReversal.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { canReversePoint, reversalReasonError, submitReversal } from './pointReversal.js';

const ORG = { id: '1', role: 'organizer' };
const MGR = { id: '100', role: 'manager' };
const MEMBER = { id: '200', role: 'member' };
const entry = (over = {}) => ({ id: '9', userId: '200', userName: 'ليان', value: 10, activity: 'ورشة', isReversal: false, reversed: false, ...over });

test('reversal button: offered on eligible entries only', () => {
  assert.equal(canReversePoint(entry(), ORG), true, 'organizer: an ordinary entry');
  assert.equal(canReversePoint(entry(), MGR), true, 'manager: a team member\'s entry');
  assert.equal(canReversePoint(entry({ value: -5 }), MGR), true, 'negative awards can be reversed too');

  assert.equal(canReversePoint(entry({ reversed: true }), ORG), false, 'already reversed');
  assert.equal(canReversePoint(entry({ reversed: true }), MGR), false, 'already reversed');
  assert.equal(canReversePoint(entry({ isReversal: true, value: -10 }), ORG), false, 'a reversal entry itself');
  assert.equal(canReversePoint(entry({ isReversal: true, value: -10 }), MGR), false, 'a reversal entry itself');

  assert.equal(canReversePoint(entry({ userId: '100' }), MGR), false, 'a manager never reverses their own points');
  assert.equal(canReversePoint(entry({ userId: 100 }), { id: 100, role: 'manager' }), false, 'ids compared as strings');
  assert.equal(canReversePoint(entry({ userId: '100' }), ORG), true, 'an organizer may reverse a manager\'s points');

  assert.equal(canReversePoint(entry(), MEMBER), false, 'members never get the button');
  assert.equal(canReversePoint(entry(), null), false);
  assert.equal(canReversePoint(null, ORG), false);
});

test('reversal confirmation: the reason is required and limited to 500 characters', () => {
  assert.equal(reversalReasonError(''), 'سبب العكس إلزامي.');
  assert.equal(reversalReasonError('   '), 'سبب العكس إلزامي.');
  assert.equal(reversalReasonError(undefined), 'سبب العكس إلزامي.');
  assert.match(reversalReasonError('x'.repeat(501)), /طويل جدًا/);
  assert.equal(reversalReasonError('x'.repeat(500)), '');
  assert.equal(reversalReasonError('أُضيفت بالخطأ'), '');
});

test('reversal confirmation: submits the entry id and the trimmed reason', async () => {
  const calls = [];
  const reverse = async (id, reason) => { calls.push([id, reason]); return { ok: true, entry: { id: '10', reverses: id } }; };
  const res = await submitReversal(entry(), '  أُضيفت للعضو الخطأ  ', reverse);
  assert.deepEqual(calls, [['9', 'أُضيفت للعضو الخطأ']]);
  assert.equal(res.entry.reverses, '9');

  await assert.rejects(() => submitReversal(entry(), ' ', reverse), /سبب العكس إلزامي/);
  assert.equal(calls.length, 1, 'nothing is sent without a reason');

  const refused = async () => { const e = new Error('هذه العملية معكوسة مسبقًا.'); e.status = 409; throw e; };
  await assert.rejects(() => submitReversal(entry(), 'سبب', refused), (e) => e.status === 409 && /معكوسة مسبقًا/.test(e.message));
});
