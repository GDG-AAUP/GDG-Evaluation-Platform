
import { Router, type Request } from 'express';
import type { Pool } from 'pg';
import { getAuditLogs } from './get-audit-logs';

type ProjectRequest = Request & {
  projectUser?: {
    id: number;
    role: string;
  };
};

function positiveInteger(
  value: unknown,
  max: number,
  defaultValue?: number
): number | null | undefined {
  if (value === undefined) return defaultValue;

  if (typeof value !== 'string' ||
      !/^[1-9]\d*$/.test(value)) {
    return null;
  }

  const n = Number(value);
  return Number.isSafeInteger(n) && n <= max ? n : null;
}

function optionalText(
  value: unknown,
  max: number
): string | null | undefined {
  if (value === undefined) return undefined;

  if (typeof value !== 'string' || value.length > max) {
    return null;
  }

  return value.trim() || undefined;
}

function optionalDate(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;

  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    return null;
  }

  return value;
}

export function createAuditRouter(pool: Pool) {
  const router = Router();

  router.get('/', async (req, res, next) => {
    const user = (req as ProjectRequest).projectUser;

    if (!user) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication is required'
        }
      });
    }

    if (user.role !== 'organizer') {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Organizer access is required'
        }
      });
    }

    const actorId = positiveInteger(req.query.actorId, 2147483647);
    const action = optionalText(req.query.action, 100);
    const entityType = optionalText(req.query.entityType, 100);
    const from = optionalDate(req.query.from);
    const to = optionalDate(req.query.to);
    const page = positiveInteger(req.query.page, 10000, 1);
    const pageSize = positiveInteger(req.query.pageSize, 100, 25);

    if (
      actorId === null || action === null ||
      entityType === null || from === null ||
      to === null || page === null ||
      pageSize === null ||
      (from !== undefined && to !== undefined && from > to)
    ) {
      return res.status(400).json({
        error: {
          code: 'INVALID_AUDIT_QUERY',
          message: 'Invalid audit log filters'
        }
      });
    }

    try {
      const result = await getAuditLogs(pool, {
        actorId,
        action,
        entityType,
        from,
        to,
        page: page!,
        pageSize: pageSize!
      });

      return res.status(200).json({ data: result });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
