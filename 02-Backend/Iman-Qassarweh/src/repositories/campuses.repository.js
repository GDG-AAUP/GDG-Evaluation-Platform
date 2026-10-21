// Reads campuses from PostgreSQL and maps database fields to API field names.
const pool = require('../config/db')

const listCampuses = async () => {
  const result = await pool.query(`
    SELECT
      campus_id AS id,
      campus_name AS name
    FROM campuses
    ORDER BY campus_id
  `)

  return result.rows
}

const findCampusById = async (id) => {
  const result = await pool.query(
    `
      SELECT
        campus_id AS id,
        campus_name AS name
      FROM campuses
      WHERE campus_id = $1
    `,
    [id],
  )

  return result.rows[0] ?? null
}

module.exports = {
  listCampuses,
  findCampusById,
}