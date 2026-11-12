// Sends transactional email over SMTP. Configured only through SMTP_HOST, SMTP_PORT, SMTP_USER,
// SMTP_PASS and FROM_EMAIL. Never throws: callers get 'sent', 'failed' or 'skipped' (not configured),
// so a mail problem can never undo a decision that is already committed.
const nodemailer = require('nodemailer')
const { logSystemEvent } = require('./system-log.service')

let transport = null
let testTransport = null

const smtpConfigured = () => Boolean(process.env.SMTP_HOST && process.env.FROM_EMAIL)

const getTransport = () => {
  if (testTransport) return testTransport
  if (!transport) {
    const port = Number(process.env.SMTP_PORT) || 587
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    })
  }
  return transport
}

const sendMail = async ({ to, subject, text }) => {
  if (!testTransport && !smtpConfigured()) {
    logSystemEvent('warning', 'Email not sent: SMTP is not configured', 'mailer')
    return 'skipped'
  }
  try {
    await getTransport().sendMail({ from: process.env.FROM_EMAIL, to, subject, text })
    return 'sent'
  } catch (error) {
    // The address and message are personal data; only the failure type is logged.
    console.error('Email delivery failed:', error.code || error.name)
    logSystemEvent('error', `Email delivery failed (${error.code || error.name})`, 'mailer')
    return 'failed'
  }
}

// Tests replace SMTP with an in-memory transport; pass null to restore.
const setTransportForTests = (fake) => { testTransport = fake }

module.exports = { sendMail, smtpConfigured, setTransportForTests }
