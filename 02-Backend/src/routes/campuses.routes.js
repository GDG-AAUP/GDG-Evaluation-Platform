// Handles campus listing and lookup, validating IDs before reading PostgreSQL.
const express = require('express')
const parsePositiveId = require('../utils/parse-positive-id')
const campusesRepository = require('../repositories/campuses.repository')

const router = express.Router()

router.get('/', async (req, res) => {
  const campuses = await campusesRepository.listCampuses()

  res.status(200).json({
    data: campuses,
  })
})

router.get('/:id', async (req, res) => {
  const id = parsePositiveId(req.params.id)

  if (id === null) {
    return res.status(400).json({
      error: {
        code: 'INVALID_CAMPUS_ID',
        message: 'Campus ID must be a positive integer',
      },
    })
  }

  const campus = await campusesRepository.findCampusById(id)

  if (campus === null) {
  return res.status(404).json({
    error: {
      code: 'CAMPUS_NOT_FOUND',
      message: 'Campus not found',
    },
  })
}

  return res.status(200).json({
    data: campus,
  })
})

module.exports = router
