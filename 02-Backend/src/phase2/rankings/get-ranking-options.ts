import type { Pool } from 'pg';

export type CampusOption = {
  id: number;
  name: string;
};

export type TeamOption = {
  id: number;
  campusId: number;
  name: string;
};

export type RankingOptions = {
  campuses: CampusOption[];
  teams: TeamOption[];
};

export async function getRankingOptions(
  pool: Pool
): Promise<RankingOptions> {

    const campus = `SELECT
        campus_id AS id,
        campus_name AS name
        FROM campuses
        ORDER BY campus_id;`;

    const team = `SELECT
        team_id AS id,
        campus_id AS "campusId",
        team_name AS name
        FROM teams
        ORDER BY campus_id, team_name, team_id;`;

    const campusResult = await pool.query(campus);
    const teamsResult  = await pool.query(team);

    return {
        campuses:campusResult.rows,
        teams:teamsResult.rows
    }
}