// Validates member and manager invitation data before creating a project account.
const validateCreateUser = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object' }
  }

  const allowedFields = ['name', 'email', 'role', 'teamId']

  if (Object.keys(body).some((key) => !allowedFields.includes(key))) {
    return { error: 'Only name, email, role and teamId are allowed' }
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

  if (!['member', 'manager'].includes(body.role)) {
    return { error: 'Role must be member or manager' }
  }

  if (!Number.isSafeInteger(body.teamId) || body.teamId <= 0 || body.teamId > 2147483647) {
    return { error: 'teamId must be a positive integer number' }
  }

  return {
    value: {
      name,
      email,
      role: body.role,
      teamId: body.teamId,
    },
  }
}

module.exports = validateCreateUser
