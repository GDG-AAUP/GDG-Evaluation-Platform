// SMTP transport settings and the exact outcome reported for each email (no network, no real mail).
const test = require('node:test')
const assert = require('node:assert/strict')

const ENV_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'FROM_EMAIL']
const withEnv = async (values, fn) => {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  for (const k of ENV_KEYS) { if (values[k] === undefined) delete process.env[k]; else process.env[k] = values[k] }
  try { return await fn() } finally {
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

const mailer = require('../src/services/mailer.service')
const GMAIL = { SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '587', SMTP_USER: 'gdg@gmail.com', SMTP_PASS: 'abcdabcdabcdabcd', FROM_EMAIL: 'GDG <gdg@gmail.com>' }

test('transport: 587 requires STARTTLS, 465 uses implicit TLS, certificates are always verified', async () => {
  await withEnv(GMAIL, () => {
    const o = mailer.transportOptions()
    assert.deepEqual([o.host, o.port, o.secure, o.requireTLS], ['smtp.gmail.com', 587, false, true])
    assert.equal(o.tls, undefined, 'no rejectUnauthorized override')
    assert.deepEqual(o.auth, { user: 'gdg@gmail.com', pass: 'abcdabcdabcdabcd' })
  })
  await withEnv({ ...GMAIL, SMTP_PORT: '465' }, () => {
    const o = mailer.transportOptions()
    assert.deepEqual([o.port, o.secure, o.requireTLS], [465, true, false])
  })
})

test('sendMail: skipped without SMTP, sent, and failed with a safe reason', async () => {
  await withEnv({}, async () => {
    const r = await mailer.sendMail({ to: 'x@x.test', subject: 's', text: 't' })
    assert.equal(r.status, 'skipped')
    assert.equal(r.error.code, 'SMTP_NOT_CONFIGURED')
  })
  const sent = []
  mailer.setTransportForTests({ sendMail: async (m) => { sent.push(m) } })
  try {
    const ok = await mailer.sendMail({ to: 'a@x.test', subject: 's', text: 't', html: '<p>h</p>' })
    assert.deepEqual(ok, { status: 'sent', error: null })
    assert.equal(sent[0].html, '<p>h</p>')
    mailer.setTransportForTests({ sendMail: async () => { throw Object.assign(new Error('535-5.7.8 Username and Password not accepted for a@x.test'), { code: 'EAUTH', responseCode: 535 }) } })
    const bad = await mailer.sendMail({ to: 'a@x.test', subject: 's', text: 't' })
    assert.equal(bad.status, 'failed')
    assert.deepEqual([bad.error.code, bad.error.responseCode], ['EAUTH', 535])
    assert.match(bad.error.message, /SMTP_USER and SMTP_PASS/)
    assert.doesNotMatch(JSON.stringify(bad.error), /a@x\.test/, 'no address in the reported reason')
  } finally {
    mailer.setTransportForTests(null)
  }
})

test('verifySmtp reports a missing configuration without connecting', async () => {
  await withEnv({}, async () => {
    const r = await mailer.verifySmtp()
    assert.equal(r.ok, false)
    assert.equal(r.error.code, 'SMTP_NOT_CONFIGURED')
  })
})
