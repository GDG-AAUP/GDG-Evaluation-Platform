// Toast wording after approving or rejecting a join request, per email outcome.
// Run: node --test src/lib/emailOutcome.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { emailOutcomeMessage } from './emailOutcome.js';

test('approval: sent / skipped (no SMTP) / failed with the reason', () => {
  assert.deepEqual(emailOutcomeMessage('approve', 'sent', null), { tone: 'ok', message: 'تمت الموافقة وإرسال الإيميل بنجاح' });
  assert.deepEqual(emailOutcomeMessage('approve', 'skipped', { code: 'SMTP_NOT_CONFIGURED' }),
    { tone: 'warn', message: 'تمت الموافقة، لكن لم يُرسل الإيميل لعدم ضبط إعدادات SMTP' });
  const auth = emailOutcomeMessage('approve', 'failed', { code: 'EAUTH' });
  assert.equal(auth.tone, 'warn');
  assert.match(auth.message, /^تمت الموافقة، لكن لم يُرسل الإيميل: /);
  assert.match(auth.message, /SMTP_USER \/ SMTP_PASS/);
  assert.match(emailOutcomeMessage('approve', 'failed', { code: 'ECONNECTION' }).message, /SMTP_HOST/);
  assert.match(emailOutcomeMessage('approve', 'failed', null).message, /تعذّر إرسال الإيميل/);
});

test('rejection uses its own wording', () => {
  assert.equal(emailOutcomeMessage('reject', 'sent').message, 'تم رفض الطلب وإرسال الإيميل بنجاح');
  assert.match(emailOutcomeMessage('reject', 'skipped').message, /^تم رفض الطلب، لكن لم يُرسل الإيميل لعدم ضبط إعدادات SMTP$/);
});
