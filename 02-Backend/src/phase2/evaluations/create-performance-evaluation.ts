
import type { Pool } from 'pg';

import {
  calculateManagerEvaluationScore
} from './validate-performance-evaluation';

import type {
  PerformanceEvaluationInput
} from './validate-performance-evaluation';

export async function createPerformanceEvaluation(
  pool: Pool,
  actorUserId: number,
  input: PerformanceEvaluationInput
) {
  const calculatedTotal = calculateManagerEvaluationScore(
    input.criteriaScores
  );

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const actorResult = await client.query(
      `SELECT role, is_active
       FROM users
       WHERE user_id = $1
       FOR SHARE`,
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
         t.campus_id
       FROM users u
       LEFT JOIN teams t ON t.team_id = u.team_id
       WHERE u.user_id = $1
       FOR SHARE OF u`,
      [input.evaluatedUserId]
    );

    const target = targetResult.rows[0];

    if (!target) {
      await client.query('ROLLBACK');
      return { outcome: 'target_not_found' as const };
    }

    if (
      target.role !== 'Manager' ||
      target.is_active !== true ||
      !Number.isInteger(target.team_id) ||
      !Number.isInteger(target.campus_id)
    ) {
      await client.query('ROLLBACK');
      return { outcome: 'target_ineligible' as const };
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
          comments: input.comments
        }),
        input.activityName
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
