// Validates new-account data (POST /api/users). Members and Managers need a team; an Organizer
// has no team and an optional own campus (campusId). Who may create what is checked in the repository.
const validateCreateUser = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object' }
  }

  const allowedFields = ['name', 'email', 'role', 'teamId', 'campusId']

  if (Object.keys(body).some((key) => !allowedFields.includes(key))) {
    return { error: 'Only name, email, role, teamId and campusId are allowed' }
  }

  if (typeof body.name !== 'string') {
    return { error: 'Name is required' }
  }

  const name = body.name.normalize('NFC').trim()

  if (name.length === 0 || name.length > 100) {
    return { error: 'Name must contain 1 to 100 characters' }
  }

  if (typeof body.email !== 'string') {
    return { error: 'Email is required' }
  }

  const email = body.email.trim().toLowerCase()

  if (
    email.length > 255 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return { error: 'Provide a valid email of up to 255 characters' }
  }

  if (!['member', 'manager', 'organizer'].includes(body.role)) {
    return { error: 'Role must be member, manager or organizer' }
  }

  const isId = (v) => Number.isSafeInteger(v) && v > 0 && v <= 2147483647

  if (body.role === 'organizer') {
    if (body.teamId !== undefined && body.teamId !== null) return { error: 'An organizer cannot belong to a team' }
    if (body.campusId !== undefined && body.campusId !== null && !isId(body.campusId)) {
      return { error: 'campusId must be a positive integer number' }
    }
    return { value: { name, email, role: 'organizer', teamId: null, campusId: body.campusId ?? null } }
  }

  if (!isId(body.teamId)) {
    return { error: 'teamId must be a positive integer number' }
  }

  if (body.campusId !== undefined) {
    return { error: 'Members and managers take the campus of their team; campusId is not allowed' }
  }

  return {
    value: {
      name,
      email,
      role: body.role,
      teamId: body.teamId,
      campusId: null,
    },
  }
}

module.exports = validateCreateUser
