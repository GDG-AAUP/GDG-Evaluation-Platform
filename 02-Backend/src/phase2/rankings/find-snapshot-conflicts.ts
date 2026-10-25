
export type SnapshotCandidate = {
  userId: number;
  rankingScope: 'Team' | 'Campus';
  teamId: number | null;
  campusId: number;
  year: number;
  month: number;
  totalPoints: number;
  rankPosition: number;
};

export type SnapshotConflict = {
  userId: number;
  rankingScope: 'Team' | 'Campus';
  year: number;
  month: number;
  rows: SnapshotCandidate[];
};

export function findSnapshotConflicts(
  rows: SnapshotCandidate[]
): SnapshotConflict[] {
  const groups = new Map<string, SnapshotCandidate[]>();

  for (const row of rows) {
    const key = `${row.userId}-${row.rankingScope}-${row.year}-${row.month}`;

    const existing = groups.get(key);

    if (existing) {
      existing.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  const conflicts: SnapshotConflict[] = [];

  for (const group of groups.values()) {
    if (group.length > 1) {
      const first = group[0];

      conflicts.push({
        userId: first.userId,
        rankingScope: first.rankingScope,
        year: first.year,
        month: first.month,
        rows: group
      });
    }
  }

  return conflicts;
}
