require('dotenv').config()

const app = require('./app')
const pool = require('./config/db')
const { logSystemEvent } = require('./services/system-log.service')

const PORT = process.env.PORT || 3001

const startServer = async () => {
  try {
    await pool.query('SELECT 1')

    console.log('PostgreSQL connected successfully')

    app.listen(PORT, () => {
      console.log(`GDG Backend running on port ${PORT}`)
      logSystemEvent('info', 'Backend started', 'server')
    })
  } catch (error) {
    console.error('Database connection failed:', error.message)
    process.exit(1)
  }
}

startServer()