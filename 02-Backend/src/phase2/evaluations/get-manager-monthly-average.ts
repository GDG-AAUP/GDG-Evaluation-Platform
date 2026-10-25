
import type { Pool } from 'pg';

export type ManagerMonthlyAverageResult =
  | {
      outcome: 'found';
      managerUserId: number;
      year: number;
      month: number;
      evaluationCount: number;
      averageScore: number | null;
    }
  | { outcome: 'not_found' }
  | { outcome: 'not_manager' };

type DatabaseRow = {
  role: string;
  evaluationCount: number | string;
  averageScore: number | string | null;
};

export async function getManagerMonthlyAverage(
  pool: Pick<Pool, 'query'>,
  managerUserId: number,
  year: number,
  month: number
): Promise<ManagerMonthlyAverageResult> {
  if (
    !Number.isInteger(managerUserId) ||
    managerUserId < 1 ||
    managerUserId > 2147483647
  ) {
    throw new RangeError('Invalid manager user ID');
  }

  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 9999
  ) {
    throw new RangeError('Invalid evaluation year');
  }

  if (
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    throw new RangeError('Invalid evaluation month');
  }

  const result = await pool.query<DatabaseRow>(
    `
    SELECT
      u.role,
      COUNT(e.evaluation_id)::int AS "evaluationCount",
      ROUND(
        AVG(e.criteria_total_score)::numeric,
        2
      ) AS "averageScore"
    FROM users u
    LEFT JOIN performance_evaluations e
      ON e.evaluated_user_id = u.user_id
      AND e.activity_date >= MAKE_DATE($2::int, $3::int, 1)
      AND e.activity_date < (
        MAKE_DATE($2::int, $3::int, 1)
        + INTERVAL '1 month'
      )
    WHERE u.user_id = $1
    GROUP BY u.user_id, u.role
    `,
    [managerUserId, year, month]
  );

  const row = result.rows[0];

  if (!row) {
    return { outcome: 'not_found' };
  }

  if (row.role !== 'Manager') {
    return { outcome: 'not_manager' };
  }

  return {
    outcome: 'found',
    managerUserId,
    year,
    month,
    evaluationCount: Number(row.evaluationCount),
    averageScore:
      row.averageScore === null
        ? null
        : Number(row.averageScore)
  };
}
