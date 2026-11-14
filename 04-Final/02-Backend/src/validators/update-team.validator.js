// Validates an organizer's team edit: rename and/or assign (managerId) or remove (null) the manager.
const validateUpdateTeam = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object' }
  }
  const allowed = ['name', 'managerId', 'reason']
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    return { error: 'Only name, managerId and reason are allowed' }
  }
  if (!Object.hasOwn(body, 'name') && !Object.hasOwn(body, 'managerId')) {
    return { error: 'Provide name or managerId' }
  }
  const value = {}
  if (Object.hasOwn(body, 'name')) {
    if (typeof body.name !== 'string') return { error: 'Team name must be a string' }
    const name = body.name.normalize('NFC').trim()
    if (name.length === 0 || name.length > 100) return { error: 'Team name must contain 1 to 100 characters' }
    value.name = name
  }
  if (Object.hasOwn(body, 'managerId')) {
    if (body.managerId !== null &&
        !(Number.isSafeInteger(body.managerId) && body.managerId > 0 && body.managerId <= 2147483647)) {
      return { error: 'managerId must be a positive integer number or null' }
    }
    value.managerId = body.managerId
  }
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 1000) {
    return { error: 'Reason must contain 1 to 1000 characters' }
  }
  value.reason = body.reason.trim()
  return { value }
}

module.exports = validateUpdateTeam
