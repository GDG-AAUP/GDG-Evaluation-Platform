// Registration lifecycle: record a Clerk sign-up as a pending request, then approve or reject it
// and email the outcome. The decision is committed first; email delivery never undoes it.
const { clerkClient } = require('@clerk/express')
const repository = require('../repositories/registrations.repository')
const usersRepository = require('../repositories/users.repository')
const { sendMail } = require('./mailer.service')

const ROLE_AR = { organizer: 'منظّم', manager: 'مدير', member: 'عضو' }
const CAMPUS_AR = { jenin: 'جنين', ramallah: 'رام الله' }
const SUBJECT = 'GDG Evaluation Platform'

const campusAr = (name) => CAMPUS_AR[String(name || '').trim().toLowerCase()] || name

// Where the approved person signs in: APP_LOGIN_URL, else the frontend origin taken from
// CLERK_INVITATION_REDIRECT_URL (#/login). Null when neither is configured.
const loginUrl = () => {
  if (process.env.APP_LOGIN_URL) return process.env.APP_LOGIN_URL.trim()
  try {
    return `${new URL(process.env.CLERK_INVITATION_REDIRECT_URL).origin}/#/login`
  } catch {
    return null
  }
}

const approvalText = (role, teamName, campusName) => {
  const place = teamName
    ? ` في فريق ${teamName} - فرع ${campusAr(campusName)}`
    : campusName ? ` - فرع ${campusAr(campusName)}` : ''
  const link = loginUrl()
  return `تهانينا! تم قبول حسابك في منصة GDG Evaluation Platform بدور ${ROLE_AR[role]}${place}. يمكنك الآن تسجيل الدخول.` +
    (link ? `\nرابط الدخول: ${link}` : '')
}

const rejectionText = (reason) =>
  'نعتذر، تم رفض طلب انضمامك إلى منصة GDG Evaluation Platform.' + (reason ? `\nالسبب: ${reason}` : '')

// ---------------------------------------------------------------- HTML versions (RTL, escaped)
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const ROLE_EN = { organizer: 'Organizer', manager: 'Manager', member: 'Member' }
const CAMPUS_EN = { jenin: 'Jenin', ramallah: 'Ramallah' }
const campusEn = (name) => CAMPUS_EN[String(name || '').trim().toLowerCase()] || name

const htmlLayout = (body) => `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;padding:24px;background:#f6f8fb;font-family:Tahoma,Arial,sans-serif;color:#1f2937">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e5e7eb">
<h2 style="margin:0 0 12px;font-size:18px">GDG Evaluation Platform</h2>${body}
<p style="margin:20px 0 0;font-size:12px;color:#6b7280">هذه رسالة آلية من منصة GDG Evaluation Platform؛ لا ترد عليها.</p>
</div></body></html>`

const approvalHtml = (role, teamName, campusName) => {
  const link = loginUrl()
  const rows = [
    ['الدور / Role', `${ROLE_AR[role]} (${ROLE_EN[role]})`],
    campusName ? ['الحرم / Campus', `${campusAr(campusName)} (${campusEn(campusName)})`] : null,
    teamName ? ['الفريق / Team', teamName] : null,
  ].filter(Boolean)
  return htmlLayout(`<p style="margin:0 0 12px">تهانينا! تم قبول طلب انضمامك إلى المنصة.</p>
<table style="border-collapse:collapse;width:100%;margin:0 0 16px">${rows.map(([k, v]) =>
    `<tr><td style="padding:6px 8px;border:1px solid #e5e7eb;background:#f9fafb;width:40%">${escapeHtml(k)}</td><td style="padding:6px 8px;border:1px solid #e5e7eb"><b>${escapeHtml(v)}</b></td></tr>`).join('')}</table>
${link ? `<p style="margin:0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#1a73e8;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none">تسجيل الدخول</a></p>
<p style="margin:8px 0 0;font-size:12px;color:#6b7280" dir="ltr">${escapeHtml(link)}</p>` : '<p style="margin:0">يمكنك الآن تسجيل الدخول إلى المنصة.</p>'}`)
}

const rejectionHtml = (reason) => htmlLayout(`<p style="margin:0 0 12px">نعتذر، تم رفض طلب انضمامك إلى منصة GDG Evaluation Platform.</p>
${reason ? `<p style="margin:0 0 12px"><b>السبب:</b> ${escapeHtml(reason)}</p>` : ''}
<p style="margin:0">إن كان لديك استفسار، تواصل مع منظّمي GDG في حرمك.</p>`)

// Uses only a VERIFIED address, preferring the primary one. Returns null without one.
const signUpDetails = (clerkUser) => {
  const verified = (clerkUser.emailAddresses || []).filter((a) => a.verification?.status === 'verified')
  const primary = verified.find((a) => a.id && a.id === clerkUser.primaryEmailAddressId) || verified[0]
  if (!primary) return null
  const email = primary.emailAddress.trim().toLowerCase()
  if (email.length > 255) return null
  const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ').normalize('NFC').trim()
    || (clerkUser.username || '').trim() || email.split('@')[0]
  return { email, name: name.slice(0, 100) }
}

// Called on the first sign-in of a Clerk account that matches no project account.
const recordSignUp = async (clerkUserId) => {
  let clerkUser
  try {
    clerkUser = await clerkClient.users.getUser(clerkUserId)
  } catch (cause) {
    if (cause.status === 404) return null
    const error = new Error('Identity provider is temporarily unavailable')
    error.code = 'CLERK_UNAVAILABLE'
    throw error
  }
  const details = signUpDetails(clerkUser)
  if (!details) return null
  return repository.createPending({ clerkUserId, ...details })
}

// POST /api/registrations/request: the email always comes from Clerk (verified), never from the form.
const submitRequest = async (clerkUserId, { fullName, role, campusId, teamId }) => {
  // Already a project account (linked by Clerk ID): nothing to request.
  if (await usersRepository.findUserByClerkId(clerkUserId)) return { outcome: 'already_registered' }
  let clerkUser
  try {
    clerkUser = await clerkClient.users.getUser(clerkUserId)
  } catch (cause) {
    if (cause.status === 404) return { outcome: 'email_not_verified' }
    const error = new Error('Identity provider is temporarily unavailable')
    error.code = 'CLERK_UNAVAILABLE'
    throw error
  }
  const details = signUpDetails(clerkUser)
  if (!details) return { outcome: 'email_not_verified' }
  return repository.submit({
    clerkUserId, email: details.email, name: fullName || details.name, role, campusId, teamId,
  })
}

// Delivery failures are recorded on the request (notification_status) and logged by the mailer;
// the decision itself is already committed and is never undone.
// notification_status records the outcome: 'sent', 'failed' (SMTP error) or 'skipped' (SMTP not
// configured). The decision is already committed; recording the status can never fail the request.
const notify = async (requestId, to, subject, text, html) => {
  const { status, error } = await sendMail({ to, subject, text, html })
  try {
    await repository.setNotificationStatus(requestId, status)
  } catch (cause) {
    console.error('Could not record the email status of registration request', requestId, cause.stack || cause)
  }
  return { emailStatus: status, emailError: error }
}

const approveRequest = async (requestId, input, actorId, access) => {
  const result = await repository.approve(requestId, input, actorId, access)
  if (result.outcome !== 'approved') return result
  const email = await notify(requestId, result.user.email, `تم قبول طلب انضمامك - ${SUBJECT}`,
    approvalText(input.role, result.teamName, result.campusName),
    approvalHtml(input.role, result.teamName, result.campusName))
  return { ...result, ...email }
}

const rejectRequest = async (requestId, reason, actorId, access) => {
  const result = await repository.reject(requestId, reason, actorId, access)
  if (result.outcome !== 'rejected') return result
  const email = await notify(requestId, result.email, `بخصوص طلب انضمامك - ${SUBJECT}`,
    rejectionText(reason), rejectionHtml(reason))
  return { outcome: 'rejected', ...email }
}

module.exports = {
  recordSignUp, submitRequest, approveRequest, rejectRequest,
  approvalText, rejectionText, approvalHtml, rejectionHtml, signUpDetails, loginUrl,
}
