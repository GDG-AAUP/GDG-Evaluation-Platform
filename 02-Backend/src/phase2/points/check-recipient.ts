

import type { PoolClient } from "pg";

type Actor = {
    id: number;
    role: 'manager' | 'organizer';
    teamId: number | null;
};

type AccessResult = 'allowed' | 'not_found' | 'forbidden';

export async function checkPointRecipient(
    client: Pick<PoolClient,'query'>,
    actor:Actor,
    recipientId: number
): Promise<AccessResult>{

    const result = await client.query(
        `SELECT
        u.user_id AS "userId",
        LOWER(u.role) AS role,
        u.team_id AS "teamId",
        u.is_active AS "isActive",
        u.deleted_at AS "deletedAt",
        t.manager_user_id AS "managerId"
        FROM users u
        LEFT JOIN teams t
            ON u.team_id = t.team_id
        WHERE u.user_id = $1;`,
        [recipientId]
    );

    const recipient = result.rows[0];

    if (!recipient) {
    return 'not_found';
    }

    if (
    recipient.role !== 'member' ||
    recipient.isActive !== true ||
    recipient.deletedAt != null ||
    recipient.teamId == null
    ) {
    return 'forbidden';
    }

    if (actor.id === recipient.userId) {
    return 'forbidden';
    }

    if (
    actor.role === 'manager' &&
    recipient.managerId !== actor.id
    ) {
    return 'forbidden';
    }

    return 'allowed';

}
