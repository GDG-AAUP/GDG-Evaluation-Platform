// Handles unexpected errors and returns a safe JSON response.
const { logSystemEvent, logSystemEventThrottled } = require('../services/system-log.service')

const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err)
  }

  if (err.type === 'entity.parse.failed' && err.status === 400) {
    return res.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'Request body must contain valid JSON',
      },
    })
  }

  if (err.code === 'INVITATION_BUSY') {
    res.set('Retry-After', '2')
    return res.status(409).json({
      error: { code: 'INVITATION_BUSY', message: 'Account linking is in progress; retry shortly' },
    })
  }
  if (err.code === 'CLERK_UNAVAILABLE') {
    logSystemEventThrottled('clerk-unavailable', 'warning', 'Identity provider request failed', 'auth')
    return res.status(503).json({
      error: { code: 'IDENTITY_PROVIDER_UNAVAILABLE', message: 'Identity verification is temporarily unavailable; retry later' },
    })
  }

  console.error('Unexpected request error:', err.name)
  logSystemEvent('error', `Unexpected ${err.name} on ${req.method} ${req.baseUrl || req.path}`, 'api')

  return res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    },
  })
}

module.exports = errorHandler
