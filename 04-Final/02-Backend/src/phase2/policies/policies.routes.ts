import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Pool } from 'pg';

import { type ProjectRequest, sendError } from '../shared/http';

type Rule = { type: 'boolean' } | { type: 'number'; min: number; max: number };

const RULES: Record<string, Rule> = {
  globalLeaderboardEnabled: { type: 'boolean' },
  // The ledger's database constraint caps one entry at 100 points.
  maxPointsPerOperation: { type: 'number', min: 1, max: 100 },
  managerCanEditOrMoveMembers: { type: 'boolean' },
  membersInMultipleTeams: { type: 'boolean' },
  multipleManagersPerTeam: { type: 'boolean' }
};

// Accepting these would claim behaviour the backend and schema do not provide.
// globalLeaderboardEnabled: Jenin and Ramallah keep strictly separate leaderboards (no combined board).
const NOT_AVAILABLE = new Set(['managerCanEditOrMoveMembers', 'membersInMultipleTeams', 'multipleManagersPerTeam', 'globalLeaderboardEnabled']);

async function readPolicies(pool: Pick<Pool, 'query'>) {
  const result = await pool.query('SELECT policy_key AS key, policy_value AS value FROM system_policies');
  return Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
}

function isValid(rule: Rule, value: unknown): boolean {
  if (rule.type === 'boolean') return typeof value === 'boolean';
  return Number.isInteger(value) && (value as number) >= rule.min && (value as number) <= rule.max;
}

/** Applies the Organizer's limit to manual point operations; reversals are exempt. */
export function createPointLimit(pool: Pool) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { projectUser: actor } = req as ProjectRequest;
    if (req.method !== 'POST' || req.path !== '/' || actor.role === 'member' || !Number.isInteger(req.body?.points)) {
      return next();
    }
    const { maxPointsPerOperation: max } = await readPolicies(pool);
    if (Math.abs(req.body.points) > max) {
      return sendError(res, 400, 'POINTS_LIMIT_EXCEEDED', `One operation cannot exceed ${max} points`);
    }
    return next();
  };
}

export function createPoliciesRouter(pool: Pool) {
  const router = Router();

  // Every role reads these: the app loads them on sign-in to decide what to offer.
  router.get('/', async (_req, res) => {
    res.status(200).json({ data: await readPolicies(pool) });
  });

  async function update(req: Request, res: Response, key: unknown, value: unknown) {
    const { projectUser: actor } = req as ProjectRequest;
    if (actor.role !== 'organizer') return sendError(res, 403, 'FORBIDDEN', 'Organizer access is required');
    if (typeof key !== 'string' || !Object.hasOwn(RULES, key)) {
      return sendError(res, 404, 'POLICY_NOT_FOUND', 'Unknown policy');
    }
    if (!isValid(RULES[key], value)) return sendError(res, 400, 'INVALID_POLICY_VALUE', 'Invalid policy value');
    if (NOT_AVAILABLE.has(key) && value === true) {
      return sendError(res, 409, 'POLICY_NOT_SUPPORTED', 'This option is not supported by the current data model');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        'SELECT policy_value AS value FROM system_policies WHERE policy_key = $1 FOR UPDATE',
        [key]
      );
      await client.query(
        `UPDATE system_policies
         SET policy_value = $2::jsonb, updated_at = CURRENT_TIMESTAMP, updated_by_user_id = $3
         WHERE policy_key = $1`,
        [key, JSON.stringify(value), actor.id]
      );
      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, old_values, new_values, reason)
         VALUES ($1, 'UPDATE_POLICY', 'system_policies', $2, $3::jsonb, $4::jsonb, 'Policy changed by organizer')`,
        [actor.id, key, JSON.stringify({ value: current.rows[0]?.value }), JSON.stringify({ value })]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return res.status(200).json({ data: await readPolicies(pool) });
  }

  router.put('/', (req, res) => update(req, res, req.body?.key, req.body?.value));
  router.put('/:key', (req, res) => update(req, res, req.params.key, req.body?.value));

  return router;
}
