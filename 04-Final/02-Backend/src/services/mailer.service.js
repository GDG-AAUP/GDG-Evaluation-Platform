// Sends transactional email over SMTP. Configured only through SMTP_HOST, SMTP_PORT, SMTP_USER,
// SMTP_PASS and FROM_EMAIL. Never throws: callers get { status: 'sent' | 'failed' | 'skipped', error },
// so a mail problem can never undo a decision that is already committed.
const nodemailer = require('nodemailer')
const { logSystemEvent } = require('./system-log.service')

let transport = null
let testTransport = null

const smtpConfigured = () => Boolean(process.env.SMTP_HOST && process.env.FROM_EMAIL)

// Port 465: implicit TLS. Any other port (587 for Gmail): plain connection upgraded with STARTTLS,
// which is required (requireTLS) so credentials never travel unencrypted. Certificates are always
// verified; there is deliberately no switch to accept invalid ones.
const transportOptions = () => {
  const port = Number(process.env.SMTP_PORT) || 587
  return {
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  }
}

const getTransport = () => {
  if (testTransport) return testTransport
  if (!transport) transport = nodemailer.createTransport(transportOptions())
  return transport
}

// Short, safe explanation of an SMTP failure: the error code, the server's reply code and a hint.
// The addresses and the message body are personal data and never appear here.
const HINTS = {
  EAUTH: 'SMTP login refused: check SMTP_USER and SMTP_PASS (for Gmail use a 16-character App Password)',
  ECONNECTION: 'Could not connect to the SMTP server: check SMTP_HOST and SMTP_PORT',
  ETIMEDOUT: 'The SMTP server did not answer in time: check SMTP_HOST, SMTP_PORT and the network',
  ESOCKET: 'The SMTP connection failed (TLS or network): check SMTP_PORT (465 = SSL, 587 = STARTTLS)',
  EENVELOPE: 'The SMTP server refused the sender or the recipient address: check FROM_EMAIL',
  EDNS: 'SMTP_HOST could not be resolved',
}
const describeError = (error) => ({
  code: error.code || error.name || 'SMTP_ERROR',
  responseCode: error.responseCode || null,
  message: HINTS[error.code] || 'The email could not be delivered',
})

const sendMail = async ({ to, subject, text, html }) => {
  if (!testTransport && !smtpConfigured()) {
    logSystemEvent('warning', 'Email not sent: SMTP is not configured (SMTP_HOST / FROM_EMAIL)', 'mailer')
    return { status: 'skipped', error: { code: 'SMTP_NOT_CONFIGURED', responseCode: null, message: 'SMTP_HOST and FROM_EMAIL are not set' } }
  }
  try {
    await getTransport().sendMail({ from: process.env.FROM_EMAIL, to, subject, text, ...(html ? { html } : {}) })
    return { status: 'sent', error: null }
  } catch (error) {
    const reason = describeError(error)
    console.error('Email delivery failed:', reason.code, reason.responseCode || '', '-', reason.message)
    logSystemEvent('error', `Email delivery failed (${reason.code}${reason.responseCode ? ` ${reason.responseCode}` : ''}): ${reason.message}`, 'mailer')
    return { status: 'failed', error: reason }
  }
}

// Login check without sending anything (used by `npm run smtp:check`).
const verifySmtp = async () => {
  if (!smtpConfigured()) return { ok: false, error: { code: 'SMTP_NOT_CONFIGURED', responseCode: null, message: 'SMTP_HOST and FROM_EMAIL are not set' } }
  try {
    await nodemailer.createTransport(transportOptions()).verify()
    return { ok: true, error: null }
  } catch (error) {
    return { ok: false, error: describeError(error) }
  }
}

// Tests replace SMTP with an in-memory transport; pass null to restore.
const setTransportForTests = (fake) => { testTransport = fake }

module.exports = { sendMail, verifySmtp, smtpConfigured, setTransportForTests, transportOptions }
