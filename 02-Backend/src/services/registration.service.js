// Registration lifecycle: record a Clerk sign-up as a pending request, then approve or reject it
// and email the outcome. The decision is committed first; email delivery never undoes it.
const { clerkClient } = require('@clerk/express')
const repository = require('../repositories/registrations.repository')
const { sendMail } = require('./mailer.service')

const ROLE_AR = { organizer: 'منظّم', manager: 'مدير', member: 'عضو' }
const CAMPUS_AR = { jenin: 'جنين', ramallah: 'رام الله' }
const SUBJECT = 'GDG Evaluation Platform'

const campusAr = (name) => CAMPUS_AR[String(name || '').trim().toLowerCase()] || name

const approvalText = (role, teamName, campusName) => {
  const place = teamName ? ` في فريق ${teamName} - فرع ${campusAr(campusName)}` : ''
  return `تهانينا! تم قبول حسابك في منصة GDG Evaluation Platform بدور ${ROLE_AR[role]}${place}. يمكنك الآن تسجيل الدخول.`
}

const rejectionText = (reason) =>
  'نعتذر، تم رفض طلب انضمامك إلى منصة GDG Evaluation Platform.' + (reason ? `\nالسبب: ${reason}` : '')

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

const notify = async (requestId, to, text) => {
  const status = await sendMail({ to, subject: SUBJECT, text })
  await repository.setNotificationStatus(requestId, status)
  return status
}

const approveRequest = async (requestId, input, actorId) => {
  const result = await repository.approve(requestId, input, actorId)
  if (result.outcome !== 'approved') return result
  const emailStatus = await notify(requestId, result.user.email,
    approvalText(input.role, result.teamName, result.campusName))
  return { ...result, emailStatus }
}

const rejectRequest = async (requestId, reason, actorId) => {
  const result = await repository.reject(requestId, reason, actorId)
  if (result.outcome !== 'rejected') return result
  const emailStatus = await notify(requestId, result.email, rejectionText(reason))
  return { outcome: 'rejected', emailStatus }
}

module.exports = { recordSignUp, approveRequest, rejectRequest, approvalText, rejectionText, signUpDetails }
