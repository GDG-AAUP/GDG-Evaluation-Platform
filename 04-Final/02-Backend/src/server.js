require('dotenv').config()

// Load lazily-required modules now, not during the first request: the JSON body decoder's
// encoding tables (iconv-lite) and the SMTP transport. Under `node --watch` a module first loaded
// mid-request could restart the server and drop that request (the "first click fails" symptom).
try { require('iconv-lite').getCodec('utf8') } catch { /* transitive dependency; preloading is only an optimisation */ }
require('nodemailer')

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