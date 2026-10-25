
import type { Pool } from 'pg';

import { getRankingOptions } from './get-ranking-options';
import { getTeamRanking } from './get-team-ranking';
import { getCampusRanking } from './get-campus-ranking';

import {
  findSnapshotConflicts
} from './find-snapshot-conflicts';

import type {
  SnapshotCandidate
} from './find-snapshot-conflicts';

type RankingRow = {
  userId: number;
  rank: number;
  totalPoints: number;
};

export type SnapshotSource = {
  teams: { id: number; campusId: number }[];
  campuses: { id: number }[];

  teamRanking: (
    teamId: number,
    year: number,
    month: number
  ) => Promise<RankingRow[]>;

  campusRanking: (
    campusId: number,
    year: number,
    month: number
  ) => Promise<RankingRow[]>;
};

export async function buildMonthlySnapshotPreview(
  source: SnapshotSource,
  year: number,
  month: number
) {
  if (!Number.isInteger(year) || year < 2000) {
    throw new RangeError('Invalid snapshot year');
  }

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError('Invalid snapshot month');
  }

  const candidates: SnapshotCandidate[] = [];

  for (const team of source.teams) {
    const rows = await source.teamRanking(
      team.id,
      year,
      month
    );

    for (const row of rows) {
      candidates.push({
        userId: row.userId,
        rankingScope: 'Team',
        teamId: team.id,
        campusId: team.campusId,
        year,
        month,
        totalPoints: row.totalPoints,
        rankPosition: row.rank
      });
    }
  }

  for (const campus of source.campuses) {
    const rows = await source.campusRanking(
      campus.id,
      year,
      month
    );

    for (const row of rows) {
      candidates.push({
        userId: row.userId,
        rankingScope: 'Campus',
        teamId: null,
        campusId: campus.id,
        year,
        month,
        totalPoints: row.totalPoints,
        rankPosition: row.rank
      });
    }
  }

  const conflicts = findSnapshotConflicts(candidates);

  return {
    year,
    month,
    candidates,
    conflicts,
    hasConflicts: conflicts.length > 0,
    emptyMonth: candidates.length === 0
  };
}

export async function previewMonthlySnapshot(
  pool: Pool,
  year: number,
  month: number
) {
  const options = await getRankingOptions(pool);

  return buildMonthlySnapshotPreview(
    {
      teams: options.teams,
      campuses: options.campuses,

      teamRanking: (teamId, y, m) =>
        getTeamRanking(pool, teamId, y, m),

      campusRanking: (campusId, y, m) =>
        getCampusRanking(pool, campusId, y, m)
    },
    year,
    month
  );
}
