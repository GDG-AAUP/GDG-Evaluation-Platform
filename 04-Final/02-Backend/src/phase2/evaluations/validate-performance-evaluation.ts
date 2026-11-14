
export const MANAGER_EVALUATION_CRITERIA = [
  { key: 'commitment', label: 'Commitment and Discipline', weight: 30 },
  { key: 'followUp', label: 'Team Follow-up', weight: 30 },
  { key: 'communication', label: 'Communication and Collaboration', weight: 20 },
  { key: 'results', label: 'Team Results', weight: 20 }
] as const;

export type PerformanceEvaluationInput = {
  evaluatedUserId: number;
  activityName: string;
  activityDate: string;
  criteriaScores: number[];
  criteriaTotalScore: number;
  comments: string | null;
};

export type EvaluationValidation =
  | { value: PerformanceEvaluationInput }
  | { error: string };

export function calculateManagerEvaluationScore(
  scores: readonly number[]
): number {
  if (
    scores.length !== MANAGER_EVALUATION_CRITERIA.length ||
    scores.some(score =>
      !Number.isInteger(score) || score < 0 || score > 100
    )
  ) {
    throw new RangeError('Invalid manager evaluation scores');
  }

  const weightedSum = scores.reduce(
    (sum, score, index) =>
      sum + score * MANAGER_EVALUATION_CRITERIA[index].weight,
    0
  );

  return Math.round(weightedSum / 100);
}

export function validatePerformanceEvaluation(
  input: unknown
): EvaluationValidation {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input)
  ) {
    return { error: 'Invalid evaluation body' };
  }

  const data = input as Record<string, unknown>;

  const allowed = new Set([
    'evaluatedUserId',
    'activityName',
    'activityDate',
    'criteriaScores',
    'comments'
  ]);

  if (Object.keys(data).some(key => !allowed.has(key))) {
    return { error: 'Unexpected evaluation fields' };
  }

  const userId = data.evaluatedUserId;

  if (
    typeof userId !== 'number' ||
    !Number.isInteger(userId) ||
    userId <= 0 ||
    userId > 2147483647
  ) {
    return { error: 'Invalid evaluated user ID' };
  }

  if (
    typeof data.activityName !== 'string' ||
    !data.activityName.trim() ||
    data.activityName.trim().length > 150
  ) {
    return {
      error: 'Activity name must contain 1–150 characters'
    };
  }

  if (
    typeof data.activityDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(data.activityDate)
  ) {
    return { error: 'Activity date must be YYYY-MM-DD' };
  }

  const date = new Date(`${data.activityDate}T00:00:00Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== data.activityDate
  ) {
    return { error: 'Invalid activity date' };
  }

  const scores = data.criteriaScores;

  if (!Array.isArray(scores) || scores.length !== 4) {
    return { error: 'Exactly 4 criterion scores are required' };
  }

  for (let i = 0; i < scores.length; i++) {
    const score: unknown = scores[i];

    if (
      typeof score !== 'number' ||
      !Number.isInteger(score) ||
      score < 0 ||
      score > 100
    ) {
      return {
        error: `Criterion ${i + 1} must be an integer from 0 to 100`
      };
    }
  }

  if (
    data.comments !== undefined &&
    data.comments !== null &&
    typeof data.comments !== 'string'
  ) {
    return { error: 'Comments must be text' };
  }

  return {
    value: {
      evaluatedUserId: userId,
      activityName: data.activityName.trim(),
      activityDate: data.activityDate,
      criteriaScores: [...scores],
      criteriaTotalScore: calculateManagerEvaluationScore(scores),
      comments: typeof data.comments === 'string'
        ? data.comments.trim() || null
        : null
    }
  };
}
