import {
  SCORECARD_CATEGORIES,
  validateScorecard,
} from "../../lib/scorecard.js";
import { CAMPUS, teamLabel } from "../../lib/constants.js";
import {
  currentScorecard,
  revisionsOf,
  scoreOf,
  rankRows,
  userById,
  uid,
  nowTs,
  logAudit,
  teamsLabel,
} from "./helpers.js";
import { E400, E403, E404, E409, requireRole } from "./views.js";

export function canRate(db, actor, target) {
  if (
    !actor ||
    actor.status !== "active" ||
    !target ||
    target.status !== "active" ||
    actor.id === target.id
  )
    return false;
  if (actor.role === "organizer") return true;
  return (
    actor.role === "manager" &&
    target.role === "member" &&
    actor.campus === target.campus &&
    target.teams.some(
      (t) =>
        actor.teams.includes(t) &&
        db.teams.some(
          (x) =>
            x.id === t && x.campus === actor.campus && x.status === "active",
        ),
    )
  );
}
const identity = (db, u) => ({
  id: u.id,
  name: u.name,
  photo: u.photo || null,
  campus: u.campus,
  role: u.role,
  teamsLabel: teamsLabel(db, u),
});
function monthExists(db, month) {
  if (!db.months.some((m) => m.id === month)) throw E404("الشهر غير موجود.");
}
export function targets(db, actor) {
  requireRole(actor, "organizer", "manager");
  return db.users
    .filter((u) => canRate(db, actor, u))
    .map((u) => ({
      ...identity(db, u),
      total: scoreOf(db, u.id, db.curMonth),
    }));
}
export function detail(db, actor, { userId, month = db.curMonth }) {
  const u = userById(db, userId);
  if (!u) throw E404("المستخدم غير موجود.");
  monthExists(db, month);
  if (
    !actor ||
    actor.status !== "active" ||
    (actor.id !== u.id && !canRate(db, actor, u))
  )
    throw E403();
  return {
    user: identity(db, u),
    month,
    current: currentScorecard(db, userId, month),
    history: revisionsOf(db, userId, month).map((r) => ({
      ...r,
      actorName: userById(db, r.actor)?.name || "—",
    })),
    categories: SCORECARD_CATEGORIES,
    locked: month !== db.curMonth || !!db.snaps[month],
  };
}
export function saveRating(
  db,
  actor,
  { userId, scores, reason, month = db.curMonth, expectedRev },
) {
  const u = userById(db, userId);
  if (!canRate(db, actor, u))
    throw E403("لا يمكنك تقييم نفسك أو مستخدم خارج صلاحياتك.");
  monthExists(db, month);
  if (
    month !== db.curMonth ||
    db.snaps[month] ||
    db.months.find((m) => m.id === month)?.status !== "open"
  )
    throw E409("هذا الشهر مقفل.");
  const v = validateScorecard(scores);
  if (!v.ok) throw E400("أكمل جميع البنود ضمن الحدود المحددة.", v.errors);
  const why = String(reason || "").trim();
  if (!why) throw E400("سبب التقييم أو التعديل مطلوب.");
  if (why.length > 2000) throw E400("السبب يجب ألا يتجاوز 2000 حرف.");
  const previous = currentScorecard(db, userId, month);
  if (expectedRev !== undefined && expectedRev !== (previous?.rev || 0))
    throw E409(
      "تم تعديل التقييم بواسطة مستخدم آخر. أغلق النافذة وافتحها مجددًا.",
    );
  const r = {
    id: uid(db, "sc"),
    targetId: userId,
    month,
    scores: { ...v.scores },
    total: v.total,
    core: v.core,
    rev: (previous?.rev || 0) + 1,
    actor: actor.id,
    ts: nowTs(db),
    reason: why,
  };
  (db.scorecards ||= []).push(r);
  logAudit(
    db,
    actor.id,
    previous ? "تعديل بطاقة تقييم" : "تسجيل بطاقة تقييم",
    "تقييم",
    u.name,
    previous?.total ?? "لم يقيّم",
    r.total,
    why,
  );
  return { ...r };
}
export function hall(
  db,
  _actor,
  { campus = "jenin", month = db.curMonth } = {},
) {
  if (!CAMPUS[campus]) throw E400("الفرع غير صحيح.");
  monthExists(db, month);

  const groups = db.teams
    .filter(
      (team) =>
        team.campus === campus && team.status === "active",
    )
    .slice(0, 4)
    .map((team) => {
      const row = rankRows(db, month, {
        campus,
        teamId: team.id,
      })[0];

      const member = row && userById(db, row.userId);

      return {
        teamId: team.id,
        name: teamLabel(team.name),
        leader: member
          ? {
              id: member.id,
              name: member.name,
              photo: member.photo || null,
              total: row.total,
            }
          : null,
      };
    });

  const award = db.awards?.[`${campus}:${month}`] || null;

  const selectedGroup = award
    ? groups.find(
        (group) =>
          group.teamId === award.teamId &&
          group.leader?.id === award.userId,
      )
    : null;

  const activityAward = award?.basis === "activity";

  const archived = !!db.snaps?.[month];

  const valid =
    activityAward &&
    (archived
      ? award.validAtClose === true
      : !!selectedGroup);

  const winner = valid
    ? {
        ...award,
        ...(!archived && selectedGroup
          ? {
              name: selectedGroup.leader.name,
              photo: selectedGroup.leader.photo,
              total: selectedGroup.leader.total,
            }
          : {}),
      }
    : null;

  return {
    campus,
    month,
    months: db.months.map((item) => ({ ...item })),
    groups,
   winner,

winnerActivities: winner
  ? (db.activityRatings || [])
      .filter(
        (entry) =>
          entry.targetId === winner.userId &&
          entry.month === month,
      )
      .sort((a, b) => b.ts - a.ts)
      .map((entry) => ({
        id: entry.id,
        title: entry.label,
        description: entry.description,
      }))
  : [],

stale: !!award && !valid,
    ratedCount: rankRows(db, month, { campus }).length,
    memberCount: db.users.filter(
      (member) =>
        member.campus === campus &&
        member.role === "member" &&
        member.status === "active",
    ).length,
    demo: !!db.demo,
    news: (db.news || [])
      .filter((item) => item.status === "published")
      .map(({ id, title, body, date }) => ({
        id,
        title,
        body,
        date,
      })),
  };
}
export function selectWinner(
  db,
  actor,
  { campus, month = db.curMonth, userId },
) {
  requireRole(actor, "organizer");

  if (activityMonthLocked(db, month)) {
    throw E409("هذا الشهر مقفل.");
  }

  const data = hall(db, actor, { campus, month });

  const group = data.groups.find(
    (item) => item.leader?.id === userId,
  );

  if (!group || actor.id === userId) {
    throw E400(
      "اختر عضوًا من متصدري الأنشطة في المجموعات الأربع.",
    );
  }

  const key = `${campus}:${month}`;
  const old = db.awards?.[key];

  const winner = {
    userId,
    name: group.leader.name,
    photo: group.leader.photo,
    total: group.leader.total,
    teamId: group.teamId,
    teamName: group.name,
    campus,
    month,
    basis: "activity",
    selectedBy: actor.id,
    selectedAt: nowTs(db),
  };

  (db.awards ||= {})[key] = winner;

  logAudit(
    db,
    actor.id,
    "اختيار عضو الشهر",
    "تكريم",
    `${CAMPUS[campus]} / ${month}`,
    old?.name || "—",
    winner.name,
    "اختيار من متصدري تقييم الأنشطة",
  );

  return { ...winner };
}
export function validatePhoto(photo) {
  if (photo === null || photo === "") return null;
  if (
    typeof photo !== "string" ||
    photo.length > 180000 ||
    !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(photo)
  )
    throw E400(
      "الصورة يجب أن تكون JPEG أو PNG أو WebP صغيرة (حتى 130 كيلوبايت بعد المعالجة).",
    );
  return photo;
}
export function newsList(db, actor) {
  requireRole(actor, "organizer");
  return db.news || [];
}
export function saveNews(db, actor, { id, title, body, status }) {
  requireRole(actor, "organizer");
  if (
    !String(title || "").trim() ||
    !String(body || "").trim() ||
    !["draft", "published"].includes(status)
  )
    throw E400("أدخل عنوانًا ونصًا وحالة صحيحة.");
  if (title.length > 160 || body.length > 3000) throw E400("الخبر طويل جدًا.");
  const old = (db.news || []).find((n) => n.id === id);
  if (id && !old) throw E404();
  const item = {
    id: old?.id || uid(db, "n"),
    title: title.trim(),
    body: body.trim(),
    status,
    date: new Date(nowTs(db)).toISOString().slice(0, 10),
  };
  if (old) Object.assign(old, item);
  else (db.news ||= []).unshift(item);
  logAudit(
    db,
    actor.id,
    "حفظ خبر",
    "أخبار",
    item.title,
    old ? "تعديل" : "جديد",
    status,
    "",
  );
  return item;
}

// Activity ratings: separate from performance scorecards.

function activityRows(db, month) {
  return (db.activityRatings || []).filter((r) => r.month === month);
}

function activityMonthLocked(db, month) {
  return (
    month !== db.curMonth ||
    !!db.snaps?.[month] ||
    db.months.find((m) => m.id === month)?.status !== "open"
  );
}

export function activityOverview(db, actor, { month = db.curMonth } = {}) {
  requireRole(actor, "organizer", "manager", "member");

  if (actor.status !== "active") throw E403();

  monthExists(db, month);

  const entries = activityRows(db, month);

  // The denominator includes all recipients in both branches.
  const totals = new Map();

  for (const entry of entries) {
    totals.set(
      entry.targetId,
      (totals.get(entry.targetId) || 0) + entry.points,
    );
  }

  const everyoneTotal = [...totals.values()].reduce(
    (sum, points) => sum + points,
    0,
  );

  // Members see themselves.
  // Managers see themselves and members they are allowed to rate.
  // Organizers see everyone.
  const visibleUsers = db.users
    .filter(
      (u) =>
        actor.role === "organizer" ||
        u.id === actor.id ||
        canRate(db, actor, u),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));

  return {
    month,
    locked: activityMonthLocked(db, month),
    everyoneTotal,
    rows: visibleUsers.map((u) => {
      const ownEntries = entries
        .filter((r) => r.targetId === u.id)
        .sort((a, b) => new Date(b.ts) - new Date(a.ts));

      const total = totals.get(u.id) || 0;

      return {
        ...identity(db, u),
        total,
        percentage: everyoneTotal ? (total / everyoneTotal) * 100 : 0,
        canRate: canRate(db, actor, u),
        entries: ownEntries.map((r) => ({
          ...r,
          actorName: userById(db, r.actor)?.name || "—",
        })),
      };
    }),
  };
}

export function saveActivity(
  db,
  actor,
  { userId, label, points, description, month = db.curMonth },
) {
  const target = userById(db, userId);

  if (!canRate(db, actor, target)) {
    throw E403("لا يمكنك تقييم نفسك أو شخص خارج مجموعتك وفرعك.");
  }

  monthExists(db, month);

  if (activityMonthLocked(db, month)) {
    throw E409("هذا الشهر مقفل.");
  }

  const title = String(label || "").trim();
  const explanation = String(description || "").trim();

  if (!title) throw E400("اسم النشاط مطلوب.");
  if (title.length > 160) throw E400("اسم النشاط يجب ألا يتجاوز 160 حرفًا.");

  if (!explanation) {
    throw E400("اشرح النشاط من أجل عرضه في صفحة الواجهة.");
  }

  if (explanation.length > 2000) {
    throw E400("شرح النشاط يجب ألا يتجاوز 2000 حرف.");
  }

  if (
    (typeof points !== "number" && typeof points !== "string") ||
    String(points).trim() === ""
  ) {
    throw E400("أدخل نقاط النشاط.");
  }

  const value = Number(points);

  if (!Number.isInteger(value) || value < 0 || value > 99) {
    throw E400("نقاط النشاط يجب أن تكون عددًا صحيحًا من 0 إلى 99.");
  }

  const entry = {
    id: uid(db, "activity"),
    targetId: userId,
    month,
    label: title,
    points: value,
    description: explanation,
    actor: actor.id,
    ts: nowTs(db),
  };

  (db.activityRatings ||= []).push(entry);

  logAudit(
    db,
    actor.id,
    "إضافة تقييم نشاط",
    "أنشطة",
    target.name,
    "—",
    value,
    `${title}: ${explanation}`,
  );

  return { ...entry };
}
export function organizerDashboard(
  db,
  actor,
  { campus = "all" } = {},
) {
  requireRole(actor, "organizer");

  if (!["all", "jenin", "ramallah"].includes(campus)) {
    throw E400("الفرع غير صحيح.");
  }

  const month = db.curMonth;
  const inScope = (user) =>
    campus === "all" || user.campus === campus;

  const members = db.users.filter(
    (user) =>
      user.role === "member" &&
      user.status === "active" &&
      inScope(user),
  );

  const managers = db.users.filter(
    (user) =>
      user.role === "manager" &&
      user.status === "active" &&
      inScope(user),
  );

  const activities = activityOverview(db, actor, { month });
  const activityById = new Map(
    activities.rows.map((row) => [row.id, row]),
  );

  const rows = members.map((member) => {
    const activity = activityById.get(member.id);

    return {
      id: member.id,
      name: member.name,
      campus: member.campus,
      teams: [...member.teams],
      performance: scoreOf(db, member.id, month),
      activityPoints: activity?.total || 0,
      activityPercentage: activity?.percentage || 0,
      activityCount: activity?.entries.length || 0,
    };
  });

  const scored = rows.filter((row) => row.performance !== null);

  const performanceTotal = scored.reduce(
    (sum, row) => sum + row.performance,
    0,
  );

  const activityPoints = rows.reduce(
    (sum, row) => sum + row.activityPoints,
    0,
  );

  const activityCount = rows.reduce(
    (sum, row) => sum + row.activityCount,
    0,
  );

  const perTeam = db.teams
    .filter(
      (team) =>
        team.status === "active" &&
        (campus === "all" || team.campus === campus),
    )
    .map((team) => {
      const people = rows.filter((row) =>
        row.teams.includes(team.id),
      );

      const rated = people.filter(
        (row) => row.performance !== null,
      );

      const teamPoints = people.reduce(
        (sum, row) => sum + row.activityPoints,
        0,
      );

      return {
        id: team.id,
        name: teamLabel(team.name),
        campus: team.campus,
        memberCount: people.length,
        performanceAverage: rated.length
          ? rated.reduce(
              (sum, row) => sum + row.performance,
              0,
            ) / rated.length
          : null,
        activityPoints: teamPoints,
        activityPercentage: activities.everyoneTotal
          ? (teamPoints / activities.everyoneTotal) * 100
          : 0,
      };
    });

  return {
    month,
    campus,
    members: {
      total: members.length,
      jenin: members.filter((user) => user.campus === "jenin").length,
      ramallah: members.filter((user) => user.campus === "ramallah").length,
    },
    managers: managers.length,
    performance: {
      total: performanceTotal,
      ratedCount: scored.length,
      average: scored.length
        ? performanceTotal / scored.length
        : 0,
    },
    activities: {
      points: activityPoints,
      count: activityCount,
      participatingMembers: rows.filter(
        (row) => row.activityCount > 0,
      ).length,
      percentage: activities.everyoneTotal
        ? (activityPoints / activities.everyoneTotal) * 100
        : 0,
    },
    perTeam,
    people: rows.sort(
      (a, b) =>
        b.activityPercentage - a.activityPercentage ||
        a.name.localeCompare(b.name, "ar"),
    ),
  };
}
export function ratingLedger(
  db,
  actor,
  { month = "", campus = "", teamId = "", kind = "" } = {},
) {
  requireRole(actor, "organizer");

  function makeRow({
    id,
    userId,
    month,
    ts,
    type,
    performance = null,
    activityPoints = null,
    legacyPoints = null,
    label,
    reason,
    actorId,
    revision = null,
  }) {
    const user = userById(db, userId);

    return {
      id: `${type}:${id}`,
      userId,
      userName: user?.name || "مستخدم غير موجود",
      campus: user?.campus || "",
      teamIds: user?.teams || [],
      teamsLabel: user ? teamsLabel(db, user) : "—",
      month,
      ts,
      type,
      performance,
      activityPoints,
      legacyPoints,
      label,
      reason,
      actorName: userById(db, actorId)?.name || "—",
      revision,
      archived: !!db.snaps?.[month],
    };
  }

  const rows = [
    ...(db.entries || []).map((entry) =>
      makeRow({
        id: entry.id,
        userId: entry.userId,
        month: entry.month,
        ts: entry.ts,
        type: "legacy",
        legacyPoints: entry.value,
        label: "سجل نقاط قديم",
        reason: entry.reason,
        actorId: entry.actor,
      }),
    ),

    ...(db.scorecards || []).map((entry) =>
      makeRow({
        id: entry.id,
        userId: entry.targetId,
        month: entry.month,
        ts: entry.ts,
        type: "performance",
        performance: entry.total,
        label: "تقييم الأداء",
        reason: entry.reason,
        actorId: entry.actor,
        revision: entry.rev,
      }),
    ),

    ...(db.activityRatings || []).map((entry) =>
      makeRow({
        id: entry.id,
        userId: entry.targetId,
        month: entry.month,
        ts: entry.ts,
        type: "activity",
        activityPoints: entry.points,
        label: entry.label,
        reason: entry.description,
        actorId: entry.actor,
      }),
    ),
  ];

  return rows
    .filter(
      (row) =>
        (!month || row.month === month) &&
        (!campus || row.campus === campus) &&
        (!teamId || row.teamIds.includes(teamId)) &&
        (!kind || row.type === kind),
    )
    .sort(
      (a, b) =>
        b.ts - a.ts ||
        String(a.id).localeCompare(String(b.id)),
    );
}