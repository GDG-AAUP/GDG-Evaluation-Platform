// Validates organizer changes while keeping authentication IDs and system fields private.
const validateUpdateUser = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Request body must be an object' }
  const fields = ['name', 'email', 'role', 'teamId', 'isActive', 'reason']
  if (Object.keys(body).some(key => !fields.includes(key))) return { error: 'Only name, email, role, teamId, isActive and reason are allowed' }
  if (!Object.keys(body).some(key => key !== 'reason')) return { error: 'Provide at least one field to change' }
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 1000) return { error: 'A reason of 1 to 1000 characters is required' }
  const value = { reason: body.reason.trim() }
  if (Object.hasOwn(body, 'name')) {
    if (typeof body.name !== 'string') return { error: 'Name must be text' }
    value.name = body.name.normalize('NFC').trim()
    if (!value.name || value.name.length > 100) return { error: 'Name must contain 1 to 100 characters' }
  }
  if (Object.hasOwn(body, 'email')) {
    if (typeof body.email !== 'string') return { error: 'Email must be text' }
    value.email = body.email.trim().toLowerCase()
    if (value.email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) return { error: 'Provide a valid email of up to 255 characters' }
  }
  if (Object.hasOwn(body, 'role')) {
    if (!['organizer', 'manager', 'member'].includes(body.role)) return { error: 'Role must be organizer, manager or member' }
    value.role = body.role
  }
  if (Object.hasOwn(body, 'teamId')) {
    if (body.teamId !== null && (!Number.isInteger(body.teamId) || body.teamId <= 0 || body.teamId > 2147483647)) return { error: 'teamId must be null or a positive PostgreSQL integer' }
    value.teamId = body.teamId
  }
  if (Object.hasOwn(body, 'isActive')) {
    if (typeof body.isActive !== 'boolean') return { error: 'isActive must be boolean' }
    value.isActive = body.isActive
  }
  if (value.role === 'organizer' && Object.hasOwn(value, 'teamId') && value.teamId !== null) return { error: 'An organizer cannot belong to a team' }
  return { value }
}

module.exports = validateUpdateUser
