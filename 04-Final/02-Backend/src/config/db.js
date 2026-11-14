const { Pool } = require('pg')

// Connection: the five DB_* variables, or DATABASE_URL (postgresql://user:pass@host:port/db, as
// given by Render, Railway, Supabase or Neon) when DB_HOST is not set. TLS follows PGSSLMODE or the
// URL's sslmode. Every connection works in Asia/Hebron time.
const connection = !process.env.DB_HOST && process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    }

const pool = new Pool({ ...connection, options: '-c timezone=Asia/Hebron' })

// An idle connection can fail when PostgreSQL restarts. Without this listener the pool emits an
// unhandled 'error' event and Node exits; with it, the broken client is discarded and replaced.
pool.on('error', (error) => {
  console.error('PostgreSQL idle client error:', error.code || error.name)
})

module.exports = pool