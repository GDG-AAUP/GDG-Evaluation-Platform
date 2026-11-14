import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';

import { type ProjectRequest, sendError } from '../shared/http';
import { campusKey } from '../shared/time';

type Db = Pick<Pool | PoolClient, 'query'>;

/* ------------------------------------------------------------------ Super Admins */

/** Clerk user IDs listed in SUPER_ADMIN_CLERK_IDS (comma-separated, trimmed). Read on every call. */
export function superAdminClerkIds(): Set<string> {
  return new Set(
    String(process.env.SUPER_ADMIN_CLERK_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  );
}

export function isSuperAdminClerkId(clerkUserId: unknown): boolean {
  return typeof clerkUserId === 'string' && clerkUserId !== '' && superAdminClerkIds().has(clerkUserId);
}

/* ------------------------------------------------------------------ settings */

export type GovernanceSettings = {
  allowOrganizerMemberEval: boolean;
  allowJeninEvalRamallah: boolean;
  allowRamallahEvalJenin: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
};

export const GOVERNANCE_FLAGS = ['allowOrganizerMemberEval', 'allowJeninEvalRamallah', 'allowRamallahEvalJenin'] as const;
type Flag = (typeof GOVERNANCE_FLAGS)[number];
const COLUMN: Record<Flag, string> = {
  allowOrganizerMemberEval: 'allow_organizer_member_eval',
  allowJeninEvalRamallah: 'allow_jenin_eval_ramallah',
  allowRamallahEvalJenin: 'allow_ramallah_eval_jenin'
};

// Missing row (migration 011 not applied) = everything restricted.
const RESTRICTED: GovernanceSettings = {
  allowOrganizerMemberEval: false,
  allowJeninEvalRamallah: false,
  allowRamallahEvalJenin: false,
  updatedBy: null,
  updatedAt: null
};

const SETTINGS_SQL = `
  SELECT allow_organizer_member_eval AS "allowOrganizerMemberEval",
         allow_jenin_eval_ramallah AS "allowJeninEvalRamallah",
         allow_ramallah_eval_jenin AS "allowRamallahEvalJenin",
         updated_by AS "updatedBy", updated_at AS "updatedAt"
  FROM governance_settings WHERE id = 1`;

/** Current flags. `lock`: FOR SHARE inside a transaction, so a concurrent toggle waits for it. */
export async function readGovernance(db: Db, lock = false): Promise<GovernanceSettings> {
  const result = await db.query(`${SETTINGS_SQL}${lock ? ' FOR SHARE' : ''}`);
  return result.rows[0] ?? { ...RESTRICTED };
}

/* ------------------------------------------------------------------ evaluation rules */

export type EvaluationParty = { role: string; isSuperAdmin: boolean; campusName: string | null };
export type Refusal = { code: string; message: string };

/**
 * Who may evaluate whom (manager evaluations, monthly performance ratings, activity ratings):
 * 1. Nobody evaluates an Organizer or a Super Admin.
 * 2. A Super Admin may evaluate any Manager or Member on either campus (audited as such).
 * 3. An Organizer evaluates Managers; Members only while allowOrganizerMemberEval is on.
 * 4. An Organizer stays on their own campus unless that direction is delegated
 *    (Jenin -> Ramallah: allowJeninEvalRamallah; Ramallah -> Jenin: allowRamallahEvalJenin).
 * Managers rating their own team's members are governed by the team rules, not by this function.
 * Returns null when allowed, or the refusal to send as 403.
 */
export function evaluationRefusal(
  actor: EvaluationParty,
  target: EvaluationParty,
  settings: Pick<GovernanceSettings, Flag>
): Refusal | null {
  if (target.role === 'organizer' || target.isSuperAdmin) {
    return { code: 'EVALUATION_TARGET_ORGANIZER', message: 'Organizers and Super Admins cannot be evaluated' };
  }
  if (target.role !== 'manager' && target.role !== 'member') {
    return { code: 'EVALUATION_TARGET_INELIGIBLE', message: 'Only Managers and Members can be evaluated' };
  }
  if (actor.isSuperAdmin) return null;
  if (actor.role !== 'organizer') return { code: 'FORBIDDEN', message: 'Organizer access is required' };
  if (target.role === 'member' && !settings.allowOrganizerMemberEval) {
    return { code: 'ORGANIZER_MEMBER_EVAL_DISABLED', message: 'Organizers are currently restricted to evaluating Managers only' };
  }
  const from = actor.campusName ? campusKey(actor.campusName) : '';
  const to = target.campusName ? campusKey(target.campusName) : '';
  if (!from) {
    return { code: 'ORGANIZER_CAMPUS_REQUIRED', message: 'Your organizer account has no campus yet; a Super Admin must assign one' };
  }
  if (!to) return { code: 'EVALUATION_TARGET_INELIGIBLE', message: 'The target does not belong to a campus' };
  if (from === to) return null;
  if (from === 'jenin' && to === 'ramallah' && settings.allowJeninEvalRamallah) return null;
  if (from === 'ramallah' && to === 'jenin' && settings.allowRamallahEvalJenin) return null;
  return { code: 'CROSS_CAMPUS_EVAL_DISABLED', message: 'Cross-campus evaluation is disabled for your campus' };
}

/** The campus an Organizer works in (users.organizer_campus_id), by name; null when unassigned. */
export async function organizerCampusName(db: Db, userId: number): Promise<string | null> {
  const result = await db.query(
    `SELECT c.campus_name AS name FROM users u
     LEFT JOIN campuses c ON c.campus_id = u.organizer_campus_id
     WHERE u.user_id = $1`,
    [userId]
  );
  return result.rows[0]?.name ?? null;
}

/** Everything an evaluation check needs about the acting Organizer, read once per request. */
export type EvaluationScope = { settings: GovernanceSettings; actor: EvaluationParty };

export async function evaluationScope(
  db: Db,
  actor: { id: number; role: string; isSuperAdmin?: boolean },
  lock = false
): Promise<EvaluationScope> {
  const [settings, campusName] = await Promise.all([
    readGovernance(db, lock),
    actor.role === 'organizer' ? organizerCampusName(db, actor.id) : Promise.resolve(null)
  ]);
  return { settings, actor: { role: actor.role, isSuperAdmin: actor.isSuperAdmin === true, campusName } };
}

/* ------------------------------------------------------------------ API */

function validatePatch(body: unknown): { value: Partial<Record<Flag, boolean>>; reason: string | null } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Request body must be an object' };
  const data = body as Record<string, unknown>;
  const unknown = Object.keys(data).filter((key) => !(GOVERNANCE_FLAGS as readonly string[]).includes(key) && key !== 'reason');
  if (unknown.length) return { error: `Unknown fields: ${unknown.join(', ')}` };
  const value: Partial<Record<Flag, boolean>> = {};
  for (const flag of GOVERNANCE_FLAGS) {
    if (data[flag] === undefined) continue;
    if (typeof data[flag] !== 'boolean') return { error: `${flag} must be a boolean` };
    value[flag] = data[flag] as boolean;
  }
  if (!Object.keys(value).length) return { error: 'Provide at least one governance flag' };
  let reason: string | null = null;
  if (data.reason !== undefined) {
    if (typeof data.reason !== 'string' || data.reason.trim().length > 1000) return { error: 'reason must be a string of up to 1000 characters' };
    reason = data.reason.trim() || null;
  }
  return { value, reason };
}

const flagsOf = (settings: GovernanceSettings) =>
  Object.fromEntries(GOVERNANCE_FLAGS.map((flag) => [flag, settings[flag]])) as Record<Flag, boolean>;

/**
 * GET /api/governance/settings: any Organizer (Super Admins included) reads the flags.
 * PATCH /api/governance/settings: Super Admins only; before/after state, actor and time are audited.
 * Mounted after loadProjectUser + requireRole('organizer').
 */
export function createGovernanceRouter(pool: Pool, log: (message: string) => void = () => {}) {
  const router = Router();

  router.get('/settings', async (req, res) => {
    const { projectUser: actor } = req as ProjectRequest;
    const settings = await readGovernance(pool);
    return res.status(200).json({ data: { ...settings, canEdit: actor.isSuperAdmin === true } });
  });

  router.patch('/settings', async (req, res) => {
    const { projectUser: actor } = req as ProjectRequest;
    if (actor.isSuperAdmin !== true) {
      return sendError(res, 403, 'SUPER_ADMIN_REQUIRED', 'Only a Super Admin can change governance settings');
    }
    const validation = validatePatch(req.body);
    if ('error' in validation) return sendError(res, 400, 'INVALID_GOVERNANCE_DATA', validation.error);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO governance_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
      const before = (await client.query(`${SETTINGS_SQL} FOR UPDATE`)).rows[0] as GovernanceSettings;
      const changes = (Object.entries(validation.value) as [Flag, boolean][]).filter(([flag, value]) => before[flag] !== value);
      if (!changes.length) {
        await client.query('COMMIT');
        return res.status(200).json({ data: { ...before, canEdit: true }, changed: false });
      }
      const assignments = changes.map(([flag], index) => `${COLUMN[flag]} = $${index + 1}`);
      const params: unknown[] = changes.map(([, value]) => value);
      params.push(actor.clerkUserId ?? String(actor.id));
      await client.query(
        `UPDATE governance_settings SET ${assignments.join(', ')}, updated_by = $${params.length}, updated_at = NOW() WHERE id = 1`,
        params
      );
      const after = (await client.query(SETTINGS_SQL)).rows[0] as GovernanceSettings;
      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_name, entity_id, old_values, new_values, reason)
         VALUES ($1, 'GOVERNANCE_SETTINGS_UPDATED', 'governance_settings', '1', $2::jsonb, $3::jsonb, $4)`,
        [
          actor.id,
          JSON.stringify(flagsOf(before)),
          JSON.stringify({ ...flagsOf(after), actorIsSuperAdmin: true, updatedBy: after.updatedBy, updatedAt: after.updatedAt }),
          validation.reason ?? 'Super Admin governance change'
        ]
      );
      await client.query('COMMIT');
      log(`Governance settings changed by Super Admin ${actor.id}: ${changes.map(([flag, value]) => `${flag}=${value}`).join(', ')}`);
      return res.status(200).json({ data: { ...after, canEdit: true }, changed: true });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  return router;
}
