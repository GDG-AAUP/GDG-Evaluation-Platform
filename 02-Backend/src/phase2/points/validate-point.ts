
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

export function validateCreatePoint(input: unknown): ValidationResult {

  // First, check that input is an object.
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input)
  ) {
    return { error: 'Request body must be an object' };
  }

  const body = input as Record<string, unknown>;

  // TODO 1: Reject unexpected field names.
    const allowedFields = ['userId', 'points', 'activityName', 'reason', 'activityDescription'];
    const unexpected = Object.keys(body).filter((key) => !allowedFields.includes(key));
    if (unexpected.length > 0){
        return {error:'unexpected fields'}
    }

  // TODO 2: Validate userId.
    if (typeof body.userId !== 'number' 
        || !Number.isInteger(body.userId) 
        || body.userId <=0
        || body.userId > 2147483647
    ){
        return {error:'Invalid user ID'};
    }

  // TODO 3: Validate points.
    if (typeof body.points !== 'number' 
    || !Number.isInteger(body.points)
    || body.points > 100 
    || body.points < -100 
    || body.points === 0 ){
        return {error :'Invalid point value'};
    }
  // TODO 4: Validate activityName and reason.
  if ( typeof body.activityName !== 'string'
    || typeof body.reason !== 'string' 
    || body.activityName.trim().length == 0
    || body.reason.trim().length == 0
    || body.activityName.trim().length > 100
   ){
    return {error :'Invalid activity name or reason'};
   }

  // TODO 5: Validate optional activityDescription.

    if (   body.activityDescription !== undefined 
        && body.activityDescription !== null 
        && typeof body.activityDescription !== 'string'
    ) {
    return { error: 'Invalid description' };
    }
  // TODO 6: Return the cleaned, valid data.
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
