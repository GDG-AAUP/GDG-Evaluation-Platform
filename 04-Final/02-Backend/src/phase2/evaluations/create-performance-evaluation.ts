
import type { Pool } from 'pg';

import {
  evaluationRefusal,
  isSuperAdminClerkId,
  readGovernance,
  type Refusal
} from '../governance/governance';

import {
  calculateManagerEvaluationScore
} from './validate-performance-evaluation';

import type {
  PerformanceEvaluationInput
} from './validate-performance-evaluation';

/**
 * Records one evaluation (four criteria, 0-100 each) of a Manager or, when governance allows, a
 * Member. `access.isSuperAdmin` comes from the verified Clerk identity (loadProjectUser); the
 * governance rules (see evaluationRefusal) are checked inside the transaction with the flags locked.
 */
export async function createPerformanceEvaluation(
  pool: Pool,
  actorUserId: number,
  input: PerformanceEvaluationInput,
  access: { isSuperAdmin?: boolean } = {}
) {
  const calculatedTotal = calculateManagerEvaluationScore(
    input.criteriaScores
  );

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const actorResult = await client.query(
      `SELECT a.role, a.is_active, oc.campus_name
       FROM users a
       LEFT JOIN campuses oc ON oc.campus_id = a.organizer_campus_id
       WHERE a.user_id = $1
       FOR SHARE OF a`,
      [actorUserId]
    );

    const actor = actorResult.rows[0];

    if (
      !actor ||
      actor.role !== 'Organizer' ||
      actor.is_active !== true
    ) {
      await client.query('ROLLBACK');
      return { outcome: 'forbidden' as const };
    }

    const targetResult = await client.query(
      `SELECT
         u.user_id,
         u.role,
         u.is_active,
         u.team_id,
         u.clerk_user_id,
         t.campus_id,
         c.campus_name
       FROM users u
       LEFT JOIN teams t ON t.team_id = u.team_id
       LEFT JOIN campuses c ON c.campus_id = t.campus_id
       WHERE u.user_id = $1
       FOR SHARE OF u`,
      [input.evaluatedUserId]
    );

    const target = targetResult.rows[0];

    if (!target) {
      await client.query('ROLLBACK');
      return { outcome: 'target_not_found' as const };
    }

    const actorIsSuperAdmin = access.isSuperAdmin === true;
    const targetParty = {
      role: String(target.role).toLowerCase(),
      isSuperAdmin: isSuperAdminClerkId(target.clerk_user_id),
      campusName: target.campus_name ?? null
    };

    // Organizers and Super Admins are never evaluated: refused before any other check.
    if (targetParty.role === 'organizer' || targetParty.isSuperAdmin) {
      await client.query('ROLLBACK');
      return {
        outcome: 'governance_denied' as const,
        refusal: { code: 'EVALUATION_TARGET_ORGANIZER', message: 'Organizers and Super Admins cannot be evaluated' } as Refusal
      };
    }

    if (
      (target.role !== 'Manager' && target.role !== 'Member') ||
      target.is_active !== true ||
      !Number.isInteger(target.team_id) ||
      !Number.isInteger(target.campus_id)
    ) {
      await client.query('ROLLBACK');
      return { outcome: 'target_ineligible' as const };
    }

    const settings = await readGovernance(client, true);
    const refusal = evaluationRefusal(
      { role: 'organizer', isSuperAdmin: actorIsSuperAdmin, campusName: actor.campus_name ?? null },
      targetParty,
      settings
    );
    if (refusal) {
      await client.query('ROLLBACK');
      return { outcome: 'governance_denied' as const, refusal };
    }

    const evaluationResult = await client.query(
      `INSERT INTO performance_evaluations (
         evaluated_user_id,
         evaluated_by_user_id,
         team_id,
         campus_id,
         activity_name,
         activity_date,
         criteria_scores,
         criteria_total_score,
         comments
       )
       VALUES (
         $1, $2, $3, $4, $5,
         $6::date, $7::jsonb, $8, $9
       )
       RETURNING
         evaluation_id::text AS id,
         evaluated_user_id AS "evaluatedUserId",
         evaluated_by_user_id AS "evaluatedByUserId",
         team_id AS "teamId",
         campus_id AS "campusId",
         criteria_total_score AS "totalScore"`,
      [
        input.evaluatedUserId,
        actorUserId,
        target.team_id,
        target.campus_id,
        input.activityName,
        input.activityDate,
        JSON.stringify(input.criteriaScores),
        calculatedTotal,
        input.comments
      ]
    );

    const evaluation = evaluationResult.rows[0];

    await client.query(
      `INSERT INTO audit_logs (
         actor_user_id,
         action,
         entity_name,
         entity_id,
         old_values,
         new_values,
         reason
       )
       VALUES (
         $1,
         'PERFORMANCE_EVALUATION_CREATED',
         'performance_evaluations',
         $2,
         NULL,
         $3::jsonb,
         $4
       )`,
      [
        actorUserId,
        evaluation.id,
        JSON.stringify({
          evaluatedUserId: input.evaluatedUserId,
          evaluatedByUserId: actorUserId,
          teamId: target.team_id,
          campusId: target.campus_id,
          activityName: input.activityName,
          activityDate: input.activityDate,
          criteriaScores: input.criteriaScores,
          totalScore: calculatedTotal,
          comments: input.comments,
          evaluatedRole: targetParty.role,
          ...(actorIsSuperAdmin ? { actorIsSuperAdmin: true } : {})
        }),
        `${targetParty.role === 'member' ? 'Member' : 'Manager'} evaluation: ${input.activityName} (${input.activityDate})` +
          (actorIsSuperAdmin ? ' [Super Admin]' : '')
      ]
    );

    await client.query('COMMIT');

    return {
      outcome: 'created' as const,
      evaluation
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original database error.
    }

    throw error;
  } finally {
    client.release();
  }
}
