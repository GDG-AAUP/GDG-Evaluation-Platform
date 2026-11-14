// Validates and normalizes team creation data before database access.
const validateCreateTeam = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object' }
  }

  const allowedFields = ['name', 'campusId', 'description']

  if (Object.keys(body).some((key) => !allowedFields.includes(key))) {
    return {
      error: 'Only name, campusId and description are allowed',
    }
  }

  if (typeof body.name !== 'string') {
    return { error: 'Team name is required' }
  }

  const name = body.name.normalize('NFC').trim()

  if (name.length === 0 || name.length > 100) {
    return {
      error: 'Team name must contain 1 to 100 characters',
    }
  }

  if (!Number.isSafeInteger(body.campusId) || body.campusId <= 0 || body.campusId > 2147483647) {
    return {
      error: 'campusId must be a positive integer number',
    }
  }

  if (
    body.description !== undefined &&
    typeof body.description !== 'string'
  ) {
    return { error: 'Description must be a string' }
  }

  const description = body.description?.trim() || null

  return {
    value: {
      name,
      campusId: body.campusId,
      description,
    },
  }
}

module.exports = validateCreateTeam
