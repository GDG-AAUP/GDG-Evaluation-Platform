export type RankingQuery = {
  scope: 'Team' | 'Campus';
  year: number;
  month: number;
  teamId: number | null;
  campusId: number | null;
};

export function validateRankingQuery(
  input: unknown
): { value: RankingQuery } | { error: string } {

    if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input)
    ) {
    return { error: 'Query must be an object' };
    }

    const query = input as Record<string, unknown>;
    const allowedFields = ['scope', 'year', 'month', 'teamId', 'campusId'];
    const unexpected = Object.keys(query).filter((key) => !allowedFields.includes(key));
    if (unexpected.length > 0){
        return {error:'unexpected fields'}
    }

    if (query.scope !== 'team' && query.scope !== 'campus'){
      return {error:'Invalid ranking scope'};
    }
    const scope:'Team'|'Campus' = query.scope === 'team'?'Team':'Campus';

    if (typeof query.year !== 'string'
      || !/^\d{4}$/.test(query.year)
    ){
      return {error:'Invalid year'}
    }
    const year = Number(query.year);

    if (year < 2000 || year > 9999){
      return {error:'Invalid year'};
    }

    if (
      typeof query.month !== 'string' ||
      !/^\d{1,2}$/.test(query.month)
    ) {
      return { error: 'Invalid month' };
    }

    const month = Number(query.month);

    if (month < 1 || month > 12) {
      return { error: 'Invalid month' };
    }

    if (scope === 'Team') {
      if (
        typeof query.teamId !== 'string' ||
        !/^[1-9]\d*$/.test(query.teamId) ||
        Number(query.teamId) > 2147483647 ||
        query.campusId !== undefined
      ) {
        return { error: 'Invalid team ID' };
      }
    }
    if (scope === 'Campus') {
      if (
        typeof query.campusId !== 'string' ||
        !/^[1-9]\d*$/.test(query.campusId) ||
        Number(query.campusId) > 2147483647 ||
        query.teamId !== undefined
      ) {
        return { error: 'Invalid campus ID' };
      }
    }

      return {
    value: {
      scope,
      year,
      month,
      teamId: scope === 'Team' ? Number(query.teamId) : null,
      campusId: scope === 'Campus' ? Number(query.campusId) : null
    }
  };
}
