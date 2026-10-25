
import { Router, type Request } from 'express';
import type { Pool } from 'pg';

import {
  validatePerformanceEvaluation
} from './validate-performance-evaluation';

import {
  createPerformanceEvaluation
} from './create-performance-evaluation';

import {
  getManagerMonthlyAverage
} from './get-manager-monthly-average';

type ProjectRequest = Request & {
  projectUser?: {
    id: number;
    role: 'organizer' | 'manager' | 'member';
    teamId: number | null;
  };
};

function parseInteger(
  value: unknown,
  min: number,
  max: number
): number | null {
  if (
    typeof value !== 'string' ||
    !/^\d+$/.test(value)
  ) {
    return null;
  }

  const number = Number(value);

  if (
    !Number.isSafeInteger(number) ||
    number < min ||
    number > max
  ) {
    return null;
  }

  return number;
}

export function createManagerEvaluationsRouter(pool: Pool) {
  const router = Router();

  router.use((req, res, next) => {
    const actor = (req as ProjectRequest).projectUser;

    if (!actor) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication is required'
        }
      });
    }

    if (actor.role !== 'organizer') {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Organizer access is required'
        }
      });
    }

    return next();
  });

  router.post('/managers', async (req, res, next) => {
    const actor = (req as ProjectRequest).projectUser!;

    const validation = validatePerformanceEvaluation(req.body);

    if ('error' in validation) {
      return res.status(400).json({
        error: {
          code: 'INVALID_EVALUATION_DATA',
          message: validation.error
        }
      });
    }

    try {
      const result = await createPerformanceEvaluation(
        pool,
        actor.id,
        validation.value
      );

      if (result.outcome === 'created') {
        return res.status(201).json({
          data: result.evaluation
        });
      }

      if (result.outcome === 'forbidden') {
        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Evaluator is not an active Organizer'
          }
        });
      }

      if (result.outcome === 'target_not_found') {
        return res.status(404).json({
          error: {
            code: 'MANAGER_NOT_FOUND',
            message: 'Manager does not exist'
          }
        });
      }

      if (result.outcome === 'target_ineligible') {
        return res.status(422).json({
          error: {
            code: 'MANAGER_INELIGIBLE',
            message: 'Target must be an active Manager'
          }
        });
      }

      throw new Error('Unexpected evaluation creation outcome');
    } catch (error) {
      return next(error);
    }
  });

  router.get(
    '/managers/:managerId/average',
    async (req, res, next) => {
      const managerId = parseInteger(
        req.params.managerId,
        1,
        2147483647
      );

      const year = parseInteger(
        req.query.year,
        2000,
        9999
      );

      const month = parseInteger(
        req.query.month,
        1,
        12
      );

      if (
        managerId === null ||
        year === null ||
        month === null
      ) {
        return res.status(400).json({
          error: {
            code: 'INVALID_EVALUATION_PERIOD',
            message:
              'A valid manager ID, year and month are required'
          }
        });
      }

      try {
        const result = await getManagerMonthlyAverage(
          pool,
          managerId,
          year,
          month
        );

        if (result.outcome === 'not_found') {
          return res.status(404).json({
            error: {
              code: 'MANAGER_NOT_FOUND',
              message: 'Manager does not exist'
            }
          });
        }

        if (result.outcome === 'not_manager') {
          return res.status(422).json({
            error: {
              code: 'NOT_A_MANAGER',
              message: 'Requested user is not a Manager'
            }
          });
        }

        return res.status(200).json({
          data: {
            managerUserId: result.managerUserId,
            year: result.year,
            month: result.month,
            evaluationCount: result.evaluationCount,
            averageScore: result.averageScore
          }
        });
      } catch (error) {
        return next(error);
      }
    }
  );

  return router;
}
