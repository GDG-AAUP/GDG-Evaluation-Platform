const { Pool } = require('pg')

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: '-c timezone=Asia/Hebron',
})

// An idle connection can fail when PostgreSQL restarts. Without this listener the pool emits an
// unhandled 'error' event and Node exits; with it, the broken client is discarded and replaced.
pool.on('error', (error) => {
  console.error('PostgreSQL idle client error:', error.code || error.name)
})

module.exports = pool