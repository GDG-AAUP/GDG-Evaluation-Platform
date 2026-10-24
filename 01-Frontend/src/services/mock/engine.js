// Mock backend, part 1: auth, reference data, leaderboard, points,
// dashboards and the assistant. Every function is `(db, actor, args) => data`
// and throws ApiError on any rule violation (permissions are enforced here,
// not only in the UI — exactly like a real backend must).

import { canSeeTeam } from '../../lib/permissions.js';
import { monthLabel, parsePoints } from '../../lib/format.js';
import { ApiError } from '../errors.js';
import {
  scoreOf, currentScorecard, logAudit, logSys, nowTs, rankRows, reverseOf, teamById, teamMembers,
  teamsLabel, totalOf, uid, userById,
} from './helpers.js';
import {
  E400, E403, E404, E409, entryView, pubUser, requireRole, rowView,
} from './views.js';

/* ------------------------------------------------------------------ auth */

export function login(db, _actor, { email, password }) {
  const em = String(email || '').trim().toLowerCase();
  const u = db.users.find((x) => x.email.toLowerCase() === em && x.pass === password && x.status !== 'deleted');
  if (!u) {
    logSys(db, 'warning', 'محاولة دخول فاشلة', 'auth');
    throw new ApiError(401, 'البريد أو كلمة المرور غير صحيحة');
  }
  if (u.status !== 'active') throw E403('هذا الحساب معطّل. تواصل مع المنظّم');
  return { token: `mock:${u.id}`, user: pubUser(db, u) };
}

export const me = (db, actor) => pubUser(db, actor);

/* -------------------------------------------------------- reference data */

export function meta(db) {
  return {
    curMonth: db.curMonth,
    months: db.months.map((m) => ({ ...m })),
    teams: db.teams.map((t) => ({ ...t })),
    criteria: db.criteria.map((c) => ({ ...c })),
  };
}

export const getPolicies = (db) => ({ ...db.policies });

/* ----------------------------------------------------------- leaderboard */

export function leaderboard(db, actor, { month, campus, teamId, global } = {}) {
  const m = month || db.curMonth;
  if (!db.months.some((x) => x.id === m)) throw E404('هذا الشهر غير موجود.');
  if (global && !db.policies.globalLeaderboardEnabled) throw E403('الترتيب العام غير مفعّل حاليًا.');
  const f = global ? {} : { campus, teamId };
  const rows = rankRows(db, m, f).map((r) => rowView(db, r, actor));
  return { month: m, archived: !!db.snaps[m], rows };
}

/* ---------------------------------------------------------------- points */

export function myPoints(db, actor, { month } = {}) {
  requireRole(actor, 'member');
  const m = month || db.curMonth;
  if (!db.months.some((x) => x.id === m)) throw E404('هذا الشهر غير موجود.');
  const all = db.entries.filter((e) => e.userId === actor.id && e.month === m).sort((a, b) => b.ts - a.ts);
  const rk = rankRows(db, m, { campus: actor.campus, teamId: actor.teams[0] }).find((r) => r.userId === actor.id);
  return {
    month: m,
    total: db.snaps[m]?.kind === 'legacy' ? all.reduce((s,e)=>s+e.value,0) : scoreOf(db,actor.id,m),
    scorecard: currentScorecard(db,actor.id,m),
    legacyTotal: all.reduce((s,e)=>s+e.value,0),
    positive: all.filter((e) => e.value > 0).reduce((s, e) => s + e.value, 0),
    negative: all.filter((e) => e.value < 0).reduce((s, e) => s + e.value, 0),
    rank: rk ? rk.rank : null,
    entries: all.map((e) => entryView(db, e)),
  };
}

/** Members the actor may give points to (used by the dialog). */
export function assignableMembers(db, actor) {
  requireRole(actor, 'organizer', 'manager');
  let ms = db.users.filter((x) => x.role === 'member' && x.status === 'active');
  if (actor.role === 'manager') ms = ms.filter((x) => x.teams.some((t) => actor.teams.includes(t)));
  return ms.map((x) => ({
    id: x.id, name: x.name, campus: x.campus, teams: [...x.teams], teamsLabel: teamsLabel(db, x),
    total: totalOf(db, x.id, db.curMonth),
  }));
}

export function addPoints(db, actor, { userId, value, reason }) {
  if (actor.role === 'member') throw E403();
  if (userId === actor.id) throw E403('لا يمكنك إضافة نقاط لنفسك.');
  const t = userById(db, userId);
  if (!t || t.role !== 'member') throw E400('اختر عضوًا من القائمة.');
  if (actor.role === 'manager' && !t.teams.some((x) => actor.teams.includes(x))) throw E403('هذا العضو ليس في فريقك.');
  if (t.status !== 'active') throw E409('لا يمكن إضافة نقاط لحساب غير فعّال.');
  const val = parsePoints(value);
  if (Number.isNaN(val) || val === 0) throw E400('أدخل عددًا صحيحًا غير صفر، مثل 10 أو -5.');
  if (!String(reason || '').trim()) throw E400('السبب إلزامي لكل عملية نقاط.');
  const max = db.policies.maxPointsPerOperation;
  if (Math.abs(val) > max) throw E400(`الحد الأقصى للعملية الواحدة هو ${max} نقطة.`);

  const before = totalOf(db, userId, db.curMonth);
  const entry = { id: uid(db, 'e'), userId, month: db.curMonth, ts: nowTs(db), value: val, reason: String(reason).trim(), actor: actor.id, reverses: null };
  db.entries.push(entry);
  logAudit(db, actor.id, 'إضافة نقاط', 'نقاط', t.name, before, before + val, entry.reason);
  return { total: before + val, entry: entryView(db, entry) };
}

export function pointsLedger(db, actor, { month, campus, teamId, kind } = {}) {
  requireRole(actor, 'organizer');
  let es = db.entries.slice();
  if (month) es = es.filter((e) => e.month === month);
  if (campus) es = es.filter((e) => (userById(db, e.userId) || {}).campus === campus);
  if (teamId) es = es.filter((e) => ((userById(db, e.userId) || {}).teams || []).includes(teamId));
  if (kind === 'pos') es = es.filter((e) => e.value > 0);
  if (kind === 'neg') es = es.filter((e) => e.value < 0);
  if (kind === 'rev') es = es.filter((e) => e.reverses || reverseOf(db, e.id));
  return es.sort((a, b) => b.ts - a.ts).map((e) => entryView(db, e));
}

export function reversePoints(db, actor, { entryId, reason }) {
  requireRole(actor, 'organizer');
  const e = db.entries.find((x) => x.id === entryId);
  if (!e) throw E404('العملية غير موجودة.');
  if (e.reverses) throw E409('لا يمكن عكس عملية عكسية.');
  if (reverseOf(db, e.id)) throw E409('هذه العملية معكوسة مسبقًا.');
  if (db.snaps[e.month]) throw E409('هذا الشهر مؤرشف. استخدم تصحيحًا متأخرًا من صفحة الأرشيف.');
  if (!String(reason || '').trim()) throw E400('سبب العكس إلزامي.');
  const t = userById(db, e.userId);
  const b = totalOf(db, e.userId, e.month);
  db.entries.push({ id: uid(db, 'e'), userId: e.userId, month: e.month, ts: nowTs(db), value: -e.value, reason: `عكس عملية: ${e.reason}`, actor: actor.id, reverses: e.id });
  logAudit(db, actor.id, 'عكس عملية نقاط', 'نقاط', t.name, b, b - e.value, String(reason).trim());
  return { ok: true };
}

/* ------------------------------------------------------------ dashboards */

export function teamOverview(db, actor, { teamId }) {
  const team = teamById(db, teamId);
  if (!team) throw E404('الفريق غير موجود.');
  if (!canSeeTeam(actor, teamId)) throw E403('لا يمكنك الوصول إلى فريق آخر.');
  const ms = teamMembers(db, teamId);
  const rk = rankRows(db, db.curMonth, { campus: team.campus, teamId });
  const mgr = (u) => ({
    id: u.id, name: u.name, email: u.email, role: u.role, status: u.status,
    total: u.role === 'member' ? scoreOf(db, u.id, db.curMonth) : null,
    isMe: u.id === actor.id,
  });
  const people = actor.role === 'manager' ? [actor, ...ms] : ms;
  return {
    team: { ...team },
    month: db.curMonth,
    metrics: {
      activeMembers: ms.filter((m) => m.status === 'active').length,
      points: rk.reduce((s, r) => s + r.total, 0),
    },
    top: rk.slice(0, 5).map((r) => rowView(db, r, actor)),
    members: people.map(mgr),
  };
}

export function orgOverview(db, actor) {
  requireRole(actor, 'organizer');
  const ms = db.users.filter((u) => u.role === 'member' && u.status === 'active');
  const jenin = ms.filter((u) => u.campus === 'jenin').length;
  return {
    month: db.curMonth,
    members: { jenin, ramallah: ms.length - jenin, total: ms.length },
    managers: db.users.filter((u) => u.role === 'manager' && u.status === 'active').length,
    pointsAdded: ms.reduce((s,u)=>s+(scoreOf(db,u.id,db.curMonth) || 0),0),
    perTeam: db.teams.map((t) => ({
      teamId: t.id, campus: t.campus, name: teamsLabel(db,{teams:[t.id]}),
      points: rankRows(db, db.curMonth, { campus: t.campus, teamId: t.id }).reduce((s, x) => s + x.total, 0),
    })),
    recent: db.audit.slice(0, 5).map((a) => ({
      id: a.id, action: a.action, entity: a.entity, ts: a.ts, actorName: (userById(db, a.actor) || {}).name || '',
    })),
  };
}

/* ------------------------------------------------------------- assistant */

export function assistant(db, actor, { question }) {
  const q = String(question || '').trim();
  if (!q) throw E400('اكتب سؤالك أولًا.');
  return { answer: botReply(db, q, actor) };
}

function botReply(db, q, u) {
  const t = q.replace(/[؟?!.،]/g, ' ').replace(/\s+/g, ' ').trim();
  const refuse = `لا أستطيع عرض بيانات خارج صلاحياتك. يمكنني مساعدتك في ${u.role === 'member' ? 'نقاطك وترتيبك.' : 'بيانات فريقك.'}`;
  const named = db.users.filter((x) => x.id !== u.id && t.includes(x.name));
  if (/(أضف|اضف|احذف|امسح|عدّل|عدل|غيّر|غير|أغلق|اغلق|انقل|عطّل|عطل)/.test(t) && /(نقاط|عضو|الشهر|دور|حساب)/.test(t) && !/كيف/.test(t)) {
    return 'لا أستطيع تنفيذ إجراءات إدارية، لكن يمكنني شرح خطوات تنفيذها.';
  }
  if (named.length) {
    if (u.role === 'member') return refuse;
    if (u.role === 'manager' && named.some((n) => !n.teams.some((x) => u.teams.includes(x)))) return refuse;
    const n = named[0];
    return `${n.name} لديه ${scoreOf(db, n.id, db.curMonth)??'لم يسجّل تقييمًا بعد؛ لا يوجد'} نقطة في ${monthLabel(db.curMonth)}.`;
  }
  const cur = monthLabel(db.curMonth);
  if (/كيف.*(يحسب|يُحسب|الترتيب)|الترتيب/.test(t) && /كيف|يحسب|يُحسب/.test(t)) {
    return 'يُرتَّب الأعضاء تنازليًا حسب مجموع نقاط الشهر. عند التعادل يتقدّم الأعلى في cat1–cat5، ثم أقدم تقييم معتمد، ثم الاسم، وتبقى نقاط الأشهر السابقة في الأرشيف.';
  }
  if (/كيف.*(أضيف|اضيف).*نقاط/.test(t)) {
    return u.role === 'member'
      ? 'إضافة النقاط ليست من صلاحيات دورك. يمكنك مشاهدة نقاطك وتفاصيلها من صفحة نقاطي.'
      : `من لوحة ${u.role === 'manager' ? 'فريقك' : 'النقاط'} اضغط تقييم عضو، اختر العضو، أكمل بنود التقييم الخمسة عشر والسبب ثم تأكيد. يُسجَّل اسمك في Audit Log.`;
  }
  if (/كيف.*(أغلق|اغلق).*الشهر/.test(t)) {
    return u.role === 'organizer'
      ? 'من الأرشيف الشهري اضغط إغلاق الشهر وأكّد. تُحفظ لقطة الترتيب ولا يُحذف شيء، ويبدأ شهر جديد من الصفر.'
      : 'هذا السؤال خارج نطاق صلاحياتك.';
  }
  if (/نقاط|نقطة|رصيد/.test(t)) {
    if (/فريق/.test(t)) {
      if (u.role === 'manager') {
        const s = rankRows(db, db.curMonth, { campus: u.campus, teamId: u.teams[0] }).reduce((a, r) => a + r.total, 0);
        return `مجموع نقاط فريقك في ${cur} هو ${s} نقطة.`;
      }
      return u.role === 'member' ? refuse : 'اختر فريقًا من صفحة الترتيب لعرض نقاطه.';
    }
    if (u.role === 'member') {
      const rk = rankRows(db, db.curMonth, { campus: u.campus, teamId: u.teams[0] }).find((r) => r.userId === u.id);
      return `لديك ${scoreOf(db, u.id, db.curMonth)??'لا يوجد تقييم بعد؛ لا توجد'} نقطة في ${cur}${rk ? `، وترتيبك ${rk.rank} في فريقك.` : '.'}`;
    }
    return 'اسأل عن عضو محدد باسمه، أو افتح صفحة الترتيب لعرض النقاط.';
  }
  if (/(كم عدد|عدد).*(أعضاء|اعضاء)/.test(t)) {
    if (u.role === 'organizer') return `في المنصة ${db.users.filter((x) => x.role === 'member' && x.status === 'active').length} عضوًا فعّالًا.`;
    return u.role === 'manager' ? `في فريقك ${teamMembers(db, u.teams[0]).filter((x) => x.status === 'active').length} عضوًا.` : refuse;
  }
  return 'لم أفهم سؤالك. يمكنني الإجابة عن نقاطك وكيفية احتساب الترتيب ضمن صلاحياتك.';
}
