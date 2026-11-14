
export function parsePointEntryId(
  input: unknown
): string | null {

    if (typeof input !== 'string') return null;

    const regex : RegExp = /^[1-9]\d*$/;

    if (!regex.test(input)) return null;
    if (BigInt(input) > 9223372036854775807n) return null;
    return input;
}

export function validateReversePoint(
  input: unknown
): { value: { reason: string } } | { error: string }{

    if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input)
    ) {
    return { error: 'Request body must be an object' };
    }

    const body = input as Record<string, unknown>;
    const reason = body.reason;
    const allowedFields = ['reason'];
    const unexpected = Object.keys(body).filter((key) => !allowedFields.includes(key));
    if (unexpected.length > 0){
        return {error:'unexpected fields'}
    }
    if (typeof reason !== 'string'){
        return {error: 'Reason must be a string'};
    }

    const trimmedReason = reason.trim();
    if (trimmedReason.length == 0 || trimmedReason.length > 500){
        return {error:'Invalid reason length'};
    }

    return {
        value: {
            reason: trimmedReason
        }
    };

}