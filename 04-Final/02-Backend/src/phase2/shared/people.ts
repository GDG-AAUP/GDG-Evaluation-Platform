import type { Pool, PoolClient } from 'pg';

import { evaluationRefusal, isSuperAdminClerkId, type EvaluationScope, type Refusal } from '../governance/governance';
import type { ProjectUser } from './http';
import { campusKey, currentYearMonth, monthId, type YearMonth } from './time';

type Db = Pick<Pool | PoolClient, 'query'>;

export type Person = {
  id: number;
  name: string;
  role: 'organizer' | 'manager' | 'member';
  isActive: boolean;
  teamManagerId: number | null;
  teamOperational: boolean | null;
  /** Team campus; for an Organizer, the campus they work in (users.organizer_campus_id). */
  campusName: string | null;
  teamName: string | null;
  clerkUserId: string | null;
};

const PERSON_SQL = `
  SELECT u.user_id AS id, u.full_name AS name, LOWER(u.role) AS role, u.is_active AS "isActive",
         t.manager_user_id AS "teamManagerId", t.is_operational AS "teamOperational",
         COALESCE(c.campus_name, oc.campus_name) AS "campusName", t.team_name AS "teamName",
         u.clerk_user_id AS "clerkUserId"
  FROM users u
  LEFT JOIN teams t ON t.team_id = u.team_id
  LEFT JOIN campuses c ON c.campus_id = t.campus_id
  LEFT JOIN campuses oc ON oc.campus_id = u.organizer_campus_id
  WHERE u.deleted_at IS NULL`;

export async function listPeople(db: Db): Promise<Person[]> {
  const result = await db.query(`${PERSON_SQL} ORDER BY u.full_name, u.user_id`);
  return result.rows;
}

/** Locks the person's row so a concurrent role or team change cannot slip past the check. */
export async function lockPerson(db: Db, userId: number): Promise<Person | null> {
  const result = await db.query(`${PERSON_SQL} AND u.user_id = $1 FOR UPDATE OF u`, [userId]);
  return result.rows[0] ?? null;
}

/** Organizers may rate anyone active but themselves; Managers, active members of their team. */
/**
 * Who may READ a person's ratings: Organizers, anyone active but themselves; Managers, active
 * members of their operational team. Rating (writing) is narrower for Organizers: see canRate.
 */
export function canViewRatings(actor: ProjectUser, target: Person): boolean {
  if (!target.isActive || target.id === actor.id) return false;
  if (actor.role === 'organizer') return true;
  return (
    actor.role === 'manager' &&
    target.role === 'member' &&
    target.teamManagerId === actor.id &&
    target.teamOperational === true
  );
}

/**
 * Why `actor` may not rate `target` (null = allowed). Managers: active members of their operational
 * team. Organizers: the governance rules (no Organizers or Super Admins, Members only when enabled,
 * own campus unless delegated; Super Admins anywhere), which need `scope` (see evaluationScope).
 */
export function rateRefusal(actor: ProjectUser, target: Person, scope?: EvaluationScope): Refusal | null {
  const outside: Refusal = { code: 'FORBIDDEN', message: 'You cannot rate yourself or anyone outside your scope' };
  if (!target.isActive || target.id === actor.id) return outside;
  if (actor.role === 'organizer') {
    if (!scope) return outside;
    return evaluationRefusal(
      scope.actor,
      { role: target.role, isSuperAdmin: isSuperAdminClerkId(target.clerkUserId), campusName: target.campusName },
      scope.settings
    );
  }
  return canViewRatings(actor, target) ? null : outside;
}

export function canRate(actor: ProjectUser, target: Person, scope?: EvaluationScope): boolean {
  return rateRefusal(actor, target, scope) === null;
}

export function identity(person: Person) {
  return {
    id: String(person.id),
    name: person.name,
    photo: null,
    campus: person.campusName ? campusKey(person.campusName) : '',
    role: person.role,
    teamsLabel: person.teamName ?? ''
  };
}

export async function closedMonthIds(db: Db): Promise<string[]> {
  const result = await db.query(
    `SELECT entity_id AS id FROM audit_logs
     WHERE action = 'MONTHLY_RANKINGS_PUBLISHED' AND entity_name = 'monthly_rankings'
     ORDER BY entity_id`
  );
  return result.rows.map((row) => row.id);
}

/** Only the running, unclosed month accepts new ratings, activities and awards. */
export function isMonthLocked(period: YearMonth, closed: string[], now: Date = new Date()): boolean {
  const id = monthId(period);
  return id !== monthId(currentYearMonth(now)) || closed.includes(id);
}

export function parseEntityId(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !/^[1-9]\d{0,9}$/.test(text)) return null;
  const id = Number(text);
  return id <= 2147483647 ? id : null;
}
