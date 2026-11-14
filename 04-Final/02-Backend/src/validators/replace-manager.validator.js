// Validates explicit manager replacement and requires the expected current manager.
const validateReplaceManager = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object' }
  }
  const allowed = ['managerId', 'expectedManagerId', 'reason']
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    return { error: 'Only managerId, expectedManagerId and reason are allowed' }
  }
  if (![body.managerId, body.expectedManagerId].every(
    (id) => Number.isSafeInteger(id) && id > 0 && id <= 2147483647,
  )) {
    return { error: 'Manager IDs must be positive integer numbers' }
  }
  if (body.managerId === body.expectedManagerId) {
    return { error: 'Replacement must be a different user' }
  }
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 1000) {
    return { error: 'Reason must contain 1 to 1000 characters' }
  }
  return {
    value: {
      managerId: body.managerId,
      expectedManagerId: body.expectedManagerId,
      reason: body.reason.trim(),
    },
  }
}

module.exports = validateReplaceManager
