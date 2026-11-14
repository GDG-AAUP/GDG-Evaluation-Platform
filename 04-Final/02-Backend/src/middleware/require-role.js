// Allows linked project users to access routes only when their role is permitted.
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.projectUser) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication is required',
        },
      })
    }

    if (!allowedRoles.includes(req.projectUser.role)) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have permission to perform this action',
        },
      })
    }

    return next()
  }
}

module.exports = requireRole
