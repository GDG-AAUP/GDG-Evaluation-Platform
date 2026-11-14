import { Router } from 'express';
import type { Pool } from 'pg';

import { queryInt, sendError } from '../shared/http';

const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 500;

export function createSyslogRouter(pool: Pool) {
  const router = Router();

  // GET /api/syslog?level=error|warning|info&page=1&pageSize=200, newest first.
  router.get('/', async (req, res) => {
    const level = req.query.level;
    const page = queryInt(req.query.page, 1, 1000000);
    const pageSize = queryInt(req.query.pageSize, 1, MAX_PAGE_SIZE);
    if (
      (level !== undefined && !['error', 'warning', 'info'].includes(String(level))) ||
      page === null ||
      pageSize === null
    ) {
      return sendError(res, 400, 'INVALID_SYSLOG_QUERY', 'Invalid level, page or page size');
    }

    const size = pageSize ?? DEFAULT_PAGE_SIZE;
    const current = page ?? 1;
    const filter = level === undefined ? null : String(level);
    const [rows, count] = await Promise.all([
      pool.query(
        `SELECT log_id::text AS id, level, message AS msg, source AS src, created_at AS "createdAt"
         FROM system_logs
         WHERE ($1::text IS NULL OR level = $1)
         ORDER BY created_at DESC, log_id DESC
         LIMIT $2 OFFSET $3`,
        [filter, size, (current - 1) * size]
      ),
      pool.query('SELECT COUNT(*)::int AS total FROM system_logs WHERE ($1::text IS NULL OR level = $1)', [filter])
    ]);

    return res.status(200).json({
      data: rows.rows.map(({ createdAt, ...row }) => ({ ...row, ts: createdAt.getTime() })),
      page: current,
      pageSize: size,
      total: count.rows[0].total
    });
  });

  return router;
}
