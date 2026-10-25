
export type CreatePointInput = {
  userId: number;
  points: number;
  activityName: string;
  reason: string;
  activityDescription: string | null;
};

type ValidationResult =
  | { value: CreatePointInput; error?: never }
  | { error: string; value?: never };

export function validateCreatePoint(input: unknown)
: ValidationResult {

  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input)
  ) {
    return { error: 'Request body must be an object' };
  }

  const body = input as Record<string, unknown>;

    const allowedFields = ['userId', 'points', 'activityName', 'reason', 'activityDescription'];
    const unexpected = Object.keys(body).filter((key) => !allowedFields.includes(key));
    if (unexpected.length > 0){
        return {error:'unexpected fields'}
    }

    if (typeof body.userId !== 'number'
        || !Number.isInteger(body.userId)
        || body.userId <=0
        || body.userId > 2147483647
    ){
        return {error:'Invalid user ID'};
    }

    if (typeof body.points !== 'number'
    || !Number.isInteger(body.points)
    || body.points > 100
    || body.points < -100
    || body.points === 0 ){
        return {error :'Invalid point value'};
    }
  if ( typeof body.activityName !== 'string'
    || typeof body.reason !== 'string'
    || body.activityName.trim().length == 0
    || body.reason.trim().length == 0
    || body.activityName.trim().length > 100
   ){
    return {error :'Invalid activity name or reason'};
   }


    if (   body.activityDescription !== undefined
        && body.activityDescription !== null
        && typeof body.activityDescription !== 'string'
    ) {
    return { error: 'Invalid description' };
    }
    return {
        value: {
            userId: body.userId,
            points: body.points,
            activityName: body.activityName.trim(),
            reason: body.reason.trim(),
            activityDescription: typeof body.activityDescription === 'string'
            ? body.activityDescription.trim() || null : null
        }
    };
}
