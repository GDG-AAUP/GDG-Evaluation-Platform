// SMTP check for the approval / rejection emails. Reads 02-Backend/.env.
//   npm run smtp:check                      -> log in only (nothing is sent)
//   npm run smtp:check -- --to you@mail.com -> log in, then send one test email to that address
// Prints the settings in use (never the password) and the exact failure reason.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true })
const nodemailer = require('nodemailer')
const { transportOptions, verifySmtp } = require('../src/services/mailer.service')

const args = process.argv.slice(2)
const toIndex = args.indexOf('--to')
const to = toIndex >= 0 ? args[toIndex + 1] : null

const mask = (value) => {
  if (!value) return '(not set)'
  const [name, domain] = String(value).split('@')
  return domain ? `${name.slice(0, 2)}***@${domain}` : `${String(value).slice(0, 2)}***`
}

const main = async () => {
  const options = transportOptions()
  console.log('SMTP settings from 02-Backend/.env')
  console.log(`  SMTP_HOST      ${options.host || '(not set)'}`)
  console.log(`  SMTP_PORT      ${options.port} (${options.secure ? 'SSL/TLS' : 'STARTTLS required'})`)
  console.log(`  SMTP_USER      ${mask(process.env.SMTP_USER)}`)
  console.log(`  SMTP_PASS      ${process.env.SMTP_PASS ? `set (${process.env.SMTP_PASS.replace(/\s/g, '').length} characters)` : '(not set)'}`)
  console.log(`  FROM_EMAIL     ${process.env.FROM_EMAIL ? process.env.FROM_EMAIL.replace(/[^<\s]+@[^>\s]+/, (a) => mask(a)) : '(not set)'}`)
  console.log(`  APP_LOGIN_URL  ${process.env.APP_LOGIN_URL || '(not set: the CLERK_INVITATION_REDIRECT_URL origin is used)'}`)

  const login = await verifySmtp()
  if (!login.ok) {
    console.log(`\nLOGIN FAILED: ${login.error.code}${login.error.responseCode ? ` (${login.error.responseCode})` : ''}`)
    console.log(`  ${login.error.message}`)
    process.exitCode = 1
    return
  }
  console.log('\nLOGIN OK: the SMTP server accepted SMTP_USER / SMTP_PASS.')

  if (!to) {
    console.log('Nothing was sent. Add  -- --to you@example.com  to send a test email.')
    return
  }
  try {
    const info = await nodemailer.createTransport(options).sendMail({
      from: process.env.FROM_EMAIL,
      to,
      subject: 'GDG Evaluation Platform - SMTP test',
      text: 'رسالة اختبار من منصة GDG Evaluation Platform. إن وصلتك، فإعدادات البريد سليمة.\nSMTP test from the GDG Evaluation Platform: delivery works.',
    })
    console.log(`SENT: the server accepted the test email for ${mask(to)} (${(info.accepted || []).length} recipient accepted).`)
    console.log('Check the inbox (and the spam folder).')
  } catch (error) {
    console.log(`SEND FAILED: ${error.code || error.name}${error.responseCode ? ` (${error.responseCode})` : ''}`)
    process.exitCode = 1
  }
}

main()
