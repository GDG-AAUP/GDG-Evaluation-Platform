// Pure helpers over the mock database object. No browser APIs here, so the
// whole mock engine can be unit-tested in plain Node.

import { nextMonth } from "../../lib/format.js";
import { teamLabel } from "../../lib/constants.js";

export const userById = (db, id) => db.users.find((u) => u.id === id);
export const teamById = (db, id) => db.teams.find((t) => t.id === id);
/** Arabic display name of a team (internal names stay English). */
export const teamName = (db, id) =>
  teamLabel((teamById(db, id) || {}).name || "");
export const teamsLabel = (db, u) =>
  u.teams.map((t) => teamName(db, t)).join("، ") || "—";

/** Monotonic id generator. */
export function uid(db, prefix) {
  db.seq += 1;
  return `${prefix || "x"}${db.seq}`;
}

/** "Now" of the mock world: real clock + a stored offset so demo dates look current. */
export const nowTs = (db) => Date.now() + (db.clockOffset || 0);

/** LEGACY: sum of the free-points ledger (pre-scorecard system). Not used for ranking any more. */
export const totalOf = (db, userId, month) =>
  db.entries
    .filter((e) => e.userId === userId && e.month === month)
    .reduce((s, e) => s + e.value, 0);

/** LEGACY: timestamp of the last ledger entry. */
export function lastTs(db, userId, month) {
  let t = 0;
  db.entries.forEach((e) => {
    if (e.userId === userId && e.month === month && e.ts > t) t = e.ts;
  });
  return t;
}

/* ------------------------------------------------------------ scorecards */

/** All revisions (immutable) for one target+month, oldest first. */
export const revisionsOf = (db, userId, month) =>
  (db.scorecards || [])
    .filter((s) => s.targetId === userId && s.month === month)
    .sort((a, b) => a.rev - b.rev);

/** The CURRENT scorecard = latest authorized revision (or null). Only this one counts. */
export function currentScorecard(db, userId, month) {
  const r = revisionsOf(db, userId, month);
  return r.length ? r[r.length - 1] : null;
}

/** Current monthly score (0..100) or null when the user has not been scored. */
export const scoreOf = (db, userId, month) => {
  const c = currentScorecard(db, userId, month);
  return c ? c.total : null;
};

/** Points from the activity ratings (Activities page) of one member in one month. */
export const activityPointsOf = (db, userId, month) =>
  (db.activityRatings || [])
    .filter((e) => e.targetId === userId && e.month === month)
    .reduce((sum, e) => sum + e.points, 0);

/**
 * Total points of a member in a month = points ledger (add / reverse points)
 * + points of the activity ratings. This is the number the ranking is based on.
 */
export const pointsOf = (db, userId, month) =>
  totalOf(db, userId, month) + activityPointsOf(db, userId, month);

/**
 * One row per (active member, active team of his campus). `total` = total points of the month.
 * Members with no points still appear (total 0), like the backend ranking.
 */
export function buildRows(db, month) {
  const counts = new Map();
  for (const entry of db.activityRatings || []) {
    if (entry.month !== month) continue;
    counts.set(entry.targetId, (counts.get(entry.targetId) || 0) + 1);
  }

  return db.users
    .filter((user) => user.role === "member" && user.status === "active")
    .flatMap((user) =>
      user.teams
        .filter((teamId) =>
          db.teams.some(
            (team) =>
              team.id === teamId &&
              team.campus === user.campus &&
              team.status === "active",
          ),
        )
        .map((teamId) => ({
          userId: user.id,
          teamId,
          campus: user.campus,
          total: pointsOf(db, user.id, month),
          activityPoints: activityPointsOf(db, user.id, month),
          activityCount: counts.get(user.id) || 0,
          last: lastTs(db, user.id, month),
          kind: "points",
        })),
    );
}

/**
 * Ranking by total points of the month (highest first). Equal totals share the same rank
 * (dense ranking, like the backend) and are listed alphabetically; `tie` marks them.
 * Archived months read the frozen snapshot.
 */
export function rankRows(db, month, filters = {}) {
  const snapshot = db.snaps?.[month];

  let rows = snapshot
    ? snapshot.rows.map((row) => ({ ...row }))
    : buildRows(db, month);

  if (filters.campus) {
    rows = rows.filter((row) => row.campus === filters.campus);
  }

  if (filters.teamId) {
    rows = rows.filter((row) => row.teamId === filters.teamId);
  } else {
    // A member in multiple groups appears once in the general ranking.
    const seen = new Set();

    rows = rows.filter((row) => {
      if (seen.has(row.userId)) return false;
      seen.add(row.userId);
      return true;
    });
  }

  const nameOf = (row) =>
    userById(db, row.userId)?.name || "";

  rows.sort(
    (a, b) =>
      b.total - a.total ||
      nameOf(a).localeCompare(nameOf(b), "ar") ||
      String(a.userId).localeCompare(String(b.userId)),
  );

  rows.forEach((row, index) => {
    const previous = rows[index - 1];

    // Equal percentages receive the same rank.
    row.rank =
      previous && previous.total === row.total
        ? previous.rank
        : index + 1;

    row.tie = rows.some(
      (other, otherIndex) =>
        otherIndex !== index && other.total === row.total,
    );
  });

  return rows;
}

export const reverseOf = (db, entryId) =>
  db.entries.find((e) => e.reverses === entryId);

export const activeOrganizers = (db) =>
  db.users.filter((u) => u.role === "organizer" && u.status === "active");

export function isLastOrganizer(db, userId) {
  const u = userById(db, userId);
  return (
    !!u &&
    u.role === "organizer" &&
    u.status === "active" &&
    activeOrganizers(db).length <= 1
  );
}

export const teamMembers = (db, teamId) =>
  db.users.filter(
    (u) =>
      u.role === "member" && u.status !== "deleted" && u.teams.includes(teamId),
  );

export function weighted(db, scores) {
  if (!scores) return null;
  return Math.round(
    scores.reduce(
      (s, v, i) => s + v * (db.criteria[i] ? db.criteria[i].w : 0),
      0,
    ) / 100,
  );
}

export function logAudit(
  db,
  actorId,
  action,
  entityType,
  entity,
  before,
  after,
  reason,
) {
  db.audit.unshift({
    id: uid(db, "a"),
    actor: actorId,
    action,
    entityType,
    entity,
    before: String(before),
    after: String(after),
    reason: reason || "",
    ts: nowTs(db),
  });
}

export function logSys(db, level, msg, src) {
  db.syslog.unshift({ id: uid(db, "s"), level, msg, src, ts: nowTs(db) });
}

/** Closes the open month: freezes a snapshot and opens the next month from zero. */
export function closeMonthCore(db, actorId, labelOf) {
  const m = db.curMonth;
  // Freeze only eligible live awards, including current identity/score.
  Object.values(db.awards || {})
    .filter((a) => a.month === m)
    .forEach((a) => {
      const leader = rankRows(db, m, { campus: a.campus, teamId: a.teamId }).find((r) => r.total > 0);
      a.validAtClose = !!leader && leader.userId === a.userId;
      if (a.validAtClose) {
        const u = userById(db, a.userId);
        Object.assign(a, {
          name: u.name,
          photo: u.photo || null,
          total: leader.total,
        });
      }
    });
  db.snaps[m] = {
    month: m,
    kind: "points",
    closedAt: nowTs(db),
    rows: buildRows(db, m),
  };
  db.months.find((x) => x.id === m).status = "archived";
  const n = nextMonth(m);
  db.months.push({ id: n, status: "open" });
  db.curMonth = n;
  logAudit(
    db,
    actorId,
    "إغلاق الشهر",
    "أرشيف",
    labelOf(m),
    "مفتوح",
    "مؤرشف",
    "إنشاء لقطة الترتيب",
  );
  return n;
}

/** Original ledger rankings retained for historical data/tests. */
export function buildLegacyRows(db, month) {
  return db.users
    .filter((u) => u.role === "member" && u.status === "active")
    .flatMap((u) =>
      u.teams.map((teamId) => ({
        userId: u.id,
        teamId,
        campus: u.campus,
        total: totalOf(db, u.id, month),
        last: lastTs(db, u.id, month),
        kind: "legacy",
      })),
    );
}
