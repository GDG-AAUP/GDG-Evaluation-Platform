// Records operational events for the System Log. Never pass tokens, keys or personal data.
const pool = require('../config/db')

const THROTTLE_MS = 60000
const lastWritten = new Map()

const writeSystemLog = async (level, message, source, db = pool) => {
  try {
    await db.query('INSERT INTO system_logs (level, message, source) VALUES ($1, $2, $3)', [level, message, source])
  } catch (error) {
    console.error('System log write failed:', error.name)
  }
}

// Fire-and-forget, so a logging problem can never fail the request being served.
const logSystemEvent = (level, message, source) => {
  if (process.env.NODE_ENV === 'test') return
  writeSystemLog(level, message, source)
}

// For repeatable events such as rejected tokens: at most one row per minute per key.
const logSystemEventThrottled = (key, level, message, source, now = Date.now()) => {
  if (now - (lastWritten.get(key) ?? 0) < THROTTLE_MS) return
  lastWritten.set(key, now)
  logSystemEvent(level, message, source)
}

module.exports = { writeSystemLog, logSystemEvent, logSystemEventThrottled }
