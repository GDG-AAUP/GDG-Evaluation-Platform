import { validatePhoto } from './ratings.js';
// Mock backend, part 2: users, teams, policies, evaluations, archive, logs.

import { CAMPUS, ROLE_LABEL } from '../../lib/constants.js';
import { isEmail, monthLabel, parsePoints } from '../../lib/format.js';
import { POLICY_FIELDS } from '../../lib/policyMeta.js';
import {
  closeMonthCore, isLastOrganizer, logAudit, nowTs, rankRows, teamById, teamMembers,
  teamsLabel, uid, userById, weighted,
} from './helpers.js';
import {
  E400, E403, E404, E409, pubUser, requireRole, rowView,
} from './views.js';

const LAST_ORG_MSG = 'يجب أن يبقى منظّم فعّال واحد على الأقل في المنصة. عيّن منظّمًا آخر أولًا ثم أعد المحاولة.';
const STATUS_AR = { active: 'نشط', disabled: 'معطّل', deleted: 'محذوف' };

/* -------------------------------------------------------------- policies */

export function setPolicy(db, actor, { key, value }) {
  requireRole(actor, 'organizer');
  const field = POLICY_FIELDS.find((f) => f.key === key);
  if (!field) throw E404('السياسة غير معروفة.');
  let v = value;
  if (field.type === 'switch') {
    if (typeof v !== 'boolean') throw E400('قيمة غير صحيحة.');
  } else if (field.type === 'number') {
    v = parseInt(value, 10);
    if (Number.isNaN(v) || v < 1 || v > 1000) throw E400('أدخل رقمًا بين 1 و1000.');
  } else if (!['off', 'propose'].includes(v)) {
    throw E400('قيمة غير صحيحة.');
  }
  const old = db.policies[key];
  db.policies[key] = v;
  logAudit(db, actor.id, 'تغيير سياسة', 'سياسة', field.label, String(old), String(v), '');
  return { ...db.policies };
}

/* ----------------------------------------------------------------- users */

export function listUsers(db, actor, { role, campus, teamId, status, deleted } = {}) {
  requireRole(actor, 'organizer');
  let us = db.users.filter((u) => (deleted ? u.status === 'deleted' : u.status !== 'deleted'));
  if (campus) us = us.filter((u) => u.campus === campus);
  if (teamId) us = us.filter((u) => u.teams.includes(teamId));
  if (role) us = us.filter((u) => u.role === role);
  if (status && !deleted) us = us.filter((u) => u.status === status);
  return us.map((u) => pubUser(db, u));
}

function validateUserPayload(db, actor, payload, existing) {
  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  let { campus, role } = payload;
  let teams = Array.isArray(payload.teams) ? [...payload.teams] : [];

  if (actor.role === 'manager') {
    // A manager may only add plain members to his own team(s).
    if (role !== 'member') throw E403();
    campus = actor.campus;
    if (!teams.length) teams = [actor.teams[0]];
    if (teams.some((t) => !actor.teams.includes(t))) throw E403('يمكنك الإضافة إلى فريقك فقط.');
  }
  if (name.length < 2) throw E400('أدخل الاسم الكامل.');
  if (!isEmail(email)) throw E400('أدخل بريدًا إلكترونيًا صحيحًا.');
  if (!CAMPUS[campus]) throw E400('اختر الحرم.');
  if (!ROLE_LABEL[role]) throw E400('اختر الدور.');
  if (db.users.some((u) => u.email.toLowerCase() === email && (!existing || u.id !== existing.id))) {
    throw E409('هذا البريد مستخدم بحساب آخر.');
  }
  if (role === 'organizer') {
    teams = [];
  } else {
    if (!teams.length) throw E400('اختر فريقًا واحدًا على الأقل.');
    if (teams.some((t) => { const tm = teamById(db, t); return !tm || tm.campus !== campus; })) {
      throw E400('الفريق لا يتبع الحرم المحدد.');
    }
    if (role === 'member' && !db.policies.membersInMultipleTeams && teams.length > 1) teams = [teams[0]];
  }
  return { name, email, campus, role, teams, photo: payload.photo === undefined ? (existing?.photo || null) : validatePhoto(payload.photo) };
}

export function createUser(db, actor, payload) {
  requireRole(actor, 'organizer');
  const v = validateUserPayload(db, actor, payload, null);
  const pw = String(payload.password || '');
  if (pw.length < 6) throw E400('كلمة المرور المؤقتة 6 أحرف على الأقل.');
  const n = { id: uid(db, 'u'), ...v, pass: pw, status: 'active', created: nowTs(db) };
  db.users.push(n);
  const what = v.role === 'member' ? 'عضو' : v.role === 'manager' ? 'مدير' : 'منظّم';
  logAudit(db, actor.id, `إضافة ${what}`, 'عضو', v.name, '—', `${ROLE_LABEL[v.role]} / ${teamsLabel(db, n)}`, '');
  return pubUser(db, n);
}

export function updateUser(db, actor, { id, ...payload }) {
  requireRole(actor, 'organizer');
  const x = userById(db, id);
  if (!x || x.status === 'deleted') throw E404('المستخدم غير موجود.');
  if (actor.role === 'manager') {
    if (!db.policies.managerCanEditOrMoveMembers) throw E403('تعديل الأعضاء ليس ضمن صلاحيات المدير حاليًا.');
    if (x.role !== 'member' || !x.teams.some((t) => actor.teams.includes(t))) throw E403('هذا العضو ليس في فريقك.');
  }
  const v = validateUserPayload(db, actor, payload, x);
  if (x.id === actor.id && v.role !== x.role) throw E403('لا يمكنك تغيير دورك بنفسك.');
  if (v.role !== x.role && isLastOrganizer(db, x.id)) throw E409(LAST_ORG_MSG, { code: 'LAST_ORGANIZER' });
  const before = `${x.name} / ${ROLE_LABEL[x.role]} / ${CAMPUS[x.campus]} / ${teamsLabel(db, x)}`;
  Object.assign(x, v);
  logAudit(db, actor.id, 'تعديل بيانات مستخدم', 'عضو', v.name, before, `${v.name} / ${ROLE_LABEL[v.role]} / ${CAMPUS[v.campus]} / ${teamsLabel(db, x)}`, '');
  return pubUser(db, x);
}

const needReason = (reason, msg = 'السبب إلزامي لهذه العملية.') => {
  const r = String(reason || '').trim();
  if (!r) throw E400(msg);
  return r;
};

export function toggleUserStatus(db, actor, { id, reason }) {
  requireRole(actor, 'organizer');
  const x = userById(db, id);
  if (!x || x.status === 'deleted') throw E404('المستخدم غير موجود.');
  const off = x.status === 'active';
  // The last-organizer protection is checked BEFORE the self check, so the sole
  // organizer gets the explanatory rule instead of a generic message.
  if (off && isLastOrganizer(db, x.id)) throw E409(LAST_ORG_MSG, { code: 'LAST_ORGANIZER' });
  if (x.id === actor.id) throw E403('لا يمكنك تعطيل حسابك بنفسك.');
  const r = needReason(reason);
  x.status = off ? 'disabled' : 'active';
  logAudit(db, actor.id, off ? 'تعطيل حساب' : 'إعادة تفعيل حساب', 'عضو', x.name, off ? 'نشط' : 'معطّل', off ? 'معطّل' : 'نشط', r);
  return pubUser(db, x);
}

export function deleteUser(db, actor, { id, reason }) {
  requireRole(actor, 'organizer');
  const x = userById(db, id);
  if (!x || x.status === 'deleted') throw E404('المستخدم غير موجود.');
  if (isLastOrganizer(db, x.id)) throw E409(LAST_ORG_MSG, { code: 'LAST_ORGANIZER' });
  if (x.id === actor.id) throw E403('لا يمكنك حذف حسابك بنفسك.');
  const r = needReason(reason);
  const b = x.status;
  x.status = 'deleted';
  logAudit(db, actor.id, 'حذف ناعم', 'عضو', x.name, STATUS_AR[b], 'محذوف', r);
  return pubUser(db, x);
}

export function restoreUser(db, actor, { id }) {
  requireRole(actor, 'organizer');
  const x = userById(db, id);
  if (!x) throw E404('المستخدم غير موجود.');
  if (x.status !== 'deleted') throw E409('هذا الحساب غير محذوف.');
  x.status = 'disabled';
  logAudit(db, actor.id, 'استرجاع حساب', 'عضو', x.name, 'محذوف', 'معطّل', '');
  return pubUser(db, x);
}

/* ----------------------------------------------------------------- teams */

export function listTeams(db, actor) {
  requireRole(actor, 'organizer');
  return db.teams.map((t) => ({
    ...t,
    managers: db.users.filter((u) => u.role === 'manager' && u.teams.includes(t.id)).map((m) => ({ id: m.id, name: m.name })),
    activeMembers: teamMembers(db, t.id).filter((x) => x.status === 'active').length,
  }));
}

/** Managers selectable for a team of the given campus. */
export function listCampusManagers(db, actor, { campus }) {
  requireRole(actor, 'organizer');
  return db.users
    .filter((u) => u.role === 'manager' && u.campus === campus && u.status !== 'deleted')
    .map((m) => ({ id: m.id, name: m.name, teams: [...m.teams] }));
}

export function saveTeam(db, actor, { id, campus, name, managerIds }) {
  requireRole(actor, 'organizer');
  const nm = String(name || '').trim();
  const existing = id ? teamById(db, id) : null;
  if (id && !existing) throw E404('الفريق غير موجود.');
  const c = existing ? existing.campus : campus;
  if (!CAMPUS[c]) throw E400('اختر الحرم.');
  if (nm.length < 2) throw E400('أدخل اسم الفريق.');
  if (db.teams.some((t) => t.campus === c && t.name.toLowerCase() === nm.toLowerCase() && t.id !== id)) {
    throw E409('يوجد فريق بهذا الاسم في هذا الحرم.');
  }
  const chosen = Array.isArray(managerIds) ? managerIds : [];
  if (!db.policies.multipleManagersPerTeam && chosen.length > 1) throw E400('يسمح بمدير واحد فقط لكل فريق حاليًا.');
  if (chosen.some((m) => { const u = userById(db, m); return !u || u.role !== 'manager' || u.campus !== c; })) {
    throw E400('اختر مديرين من نفس الحرم.');
  }
  let t = existing;
  const before = t ? t.name : '—';
  if (!t) {
    db.seq += 1;
    t = { id: `${c}-${nm.toLowerCase().replace(/\s+/g, '-')}-${db.seq}`, campus: c, name: nm, status: 'active' };
    db.teams.push(t);
  } else {
    t.name = nm;
  }
  db.users.filter((u) => u.role === 'manager' && u.campus === c).forEach((m) => {
    const has = m.teams.includes(t.id);
    const want = chosen.includes(m.id);
    if (want && !has) m.teams.push(t.id);
    if (!want && has) m.teams = m.teams.filter((x) => x !== t.id);
  });
  logAudit(db, actor.id, existing ? 'تعديل فريق' : 'إضافة فريق', 'فريق', `${nm} - ${CAMPUS[c]}`, before,
    `${nm} / ${chosen.map((i) => userById(db, i).name).join('، ') || 'بدون مدير'}`, '');
  return { ...t };
}

export function toggleTeam(db, actor, { id, reason }) {
  requireRole(actor, 'organizer');
  const t = teamById(db, id);
  if (!t) throw E404('الفريق غير موجود.');
  const off = t.status === 'active';
  const r = needReason(reason);
  t.status = off ? 'disabled' : 'active';
  logAudit(db, actor.id, off ? 'تعطيل فريق' : 'تفعيل فريق', 'فريق', `${t.name} - ${CAMPUS[t.campus]}`, off ? 'فعّال' : 'معطّل', off ? 'معطّل' : 'فعّال', r);
  return { ...t };
}

/* ----------------------------------------------------------- evaluations */

export function evaluations(db, actor, { campus }) {
  requireRole(actor, 'organizer');
  const E = db.evals[db.curMonth] || {};
  const rows = db.users
    .filter((u) => u.role === 'manager' && u.campus === campus && u.status !== 'deleted')
    .map((m) => {
      const e = E[m.id] || { scores: null, status: 'none' };
      return { managerId: m.id, name: m.name, teamsLabel: teamsLabel(db, m), score: weighted(db, e.scores), status: e.status };
    });
  rows.sort((a, b) => (b.score == null ? -1 : b.score) - (a.score == null ? -1 : a.score));
  return { period: db.curMonth, criteria: db.criteria.map((c) => ({ ...c })), rows };
}

export function evaluationDetail(db, actor, { managerId }) {
  requireRole(actor, 'organizer');
  const m = userById(db, managerId);
  if (!m || m.role !== 'manager') throw E404('المدير غير موجود.');
  const e = (db.evals[db.curMonth] || {})[managerId] || { scores: null, status: 'none' };
  return { manager: { id: m.id, name: m.name }, scores: e.scores ? [...e.scores] : null, status: e.status, score: weighted(db, e.scores), criteria: db.criteria.map((c) => ({ ...c })) };
}

export function saveEvaluation(db, actor, { managerId, scores, approve }) {
  requireRole(actor, 'organizer');
  const m = userById(db, managerId);
  if (!m || m.role !== 'manager') throw E404('المدير غير موجود.');
  if (!Array.isArray(scores) || scores.length !== db.criteria.length
    || scores.some((v) => typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100)) {
    throw E400('أدخل درجة صحيحة من 0 إلى 100 لكل معيار.');
  }
  const E = (db.evals[db.curMonth] = db.evals[db.curMonth] || {});
  if (E[managerId] && E[managerId].status === 'approved') throw E409('التقييم معتمد ومقفل ولا يمكن تعديله.');
  const before = E[managerId] ? `${weighted(db, E[managerId].scores)} (${E[managerId].status})` : '—';
  E[managerId] = { scores: [...scores], status: approve ? 'approved' : 'draft' };
  logAudit(db, actor.id, approve ? 'اعتماد تقييم مدير' : 'حفظ مسودة تقييم', 'تقييم', `${m.name} - ${CAMPUS[m.campus]}`, before,
    `${weighted(db, scores)}${approve ? ' (معتمد)' : ' (مسودة)'}`, '');
  return { score: weighted(db, scores), status: E[managerId].status };
}

export function setCriteria(db, actor, { criteria }) {
  requireRole(actor, 'organizer');
  if (!Array.isArray(criteria) || criteria.length !== db.criteria.length) throw E400('عدد المعايير غير صحيح.');
  const names = criteria.map((c) => String(c.n || '').trim());
  const ws = criteria.map((c) => Number(c.w));
  if (names.some((n) => !n)) throw E400('أدخل اسمًا لكل معيار.');
  if (ws.some((w) => Number.isNaN(w) || w < 0) || ws.reduce((a, b) => a + b, 0) !== 100) throw E400('مجموع الأوزان يجب أن يساوي 100.');
  const b = db.criteria.map((c) => `${c.n} ${c.w}`).join('، ');
  db.criteria.forEach((c, i) => { c.n = names[i]; c.w = ws[i]; });
  logAudit(db, actor.id, 'تعديل معايير التقييم', 'تقييم', 'المعايير', b, db.criteria.map((c) => `${c.n} ${c.w}`).join('، '), '');
  return db.criteria.map((c) => ({ ...c }));
}

/* --------------------------------------------------------------- archive */

export function archiveOverview(db, actor) {
  requireRole(actor, 'organizer');
  return {
    curMonth: db.curMonth,
    months: db.months.map((m) => ({ ...m })).reverse(),
    corrections: db.corrections.slice().reverse().map((c) => ({
      id: c.id, month: c.month, userId: c.userId, userName: (userById(db, c.userId) || {}).name || '',
      value: c.value, reason: c.reason, actorName: (userById(db, c.actor) || {}).name || '', ts: c.ts,
    })),
    members: db.users.filter((u) => u.role === 'member' && u.status !== 'deleted')
      .map((u) => ({ id: u.id, name: u.name, campus: u.campus })),
  };
}

export function closeMonth(db, actor) {
  requireRole(actor, 'organizer');
  const n = closeMonthCore(db, actor.id, monthLabel);
  return { curMonth: n };
}

export function snapshot(db, actor, { month, campus, teamId }) {
  requireRole(actor, 'organizer');
  if (!db.snaps[month]) throw E404('لا توجد لقطة لهذا الشهر.');
  const rows = rankRows(db, month, { campus: campus || undefined, teamId: teamId || undefined }).map((r) => rowView(db, r, actor));
  return { month, closedAt: db.snaps[month].closedAt, rows };
}

export function addCorrection(db, actor, { month, userId, value, reason }) {
  requireRole(actor, 'organizer');
  if (!db.snaps[month]) throw E400('اختر شهرًا مؤرشفًا.');
  const u = userById(db, userId);
  if (!u || u.role !== 'member' || u.status === 'deleted') throw E400('اختر عضوًا من القائمة.');
  const v = parsePoints(value);
  if (Number.isNaN(v) || v === 0) throw E400('أدخل عددًا صحيحًا غير صفر.');
  const max = db.policies.maxPointsPerOperation;
  if (Math.abs(v) > max) throw E400(`الحد الأقصى للعملية ${max} نقطة.`);
  const r = String(reason || '').trim();
  if (!r) throw E400('السبب إلزامي.');
  const c = { id: uid(db, 'c'), month, userId, value: v, reason: r, actor: actor.id, ts: nowTs(db) };
  db.corrections.push(c);
  logAudit(db, actor.id, 'تصحيح متأخر', 'أرشيف', `${u.name} - ${monthLabel(month)}`, '—', `${v > 0 ? '+' : ''}${v}`, r);
  return { id: c.id };
}

/* ------------------------------------------------------------------ logs */

export function auditLog(db, actor, { actorId, action, entityType, from, to } = {}) {
  requireRole(actor, 'organizer');
  let as = db.audit.slice();
  if (actorId) as = as.filter((a) => a.actor === actorId);
  if (action) as = as.filter((a) => a.action === action);
  if (entityType) as = as.filter((a) => a.entityType === entityType);
  if (from) as = as.filter((a) => a.ts >= new Date(`${from}T00:00:00`).getTime());
  if (to) as = as.filter((a) => a.ts <= new Date(`${to}T23:59:59`).getTime());
  as.sort((a, b) => b.ts - a.ts);
  const uniq = (arr) => Array.from(new Set(arr));
  return {
    items: as.map((a) => ({ ...a, actorName: (userById(db, a.actor) || {}).name || '' })),
    filters: {
      actors: uniq(db.audit.map((a) => a.actor)).map((i) => ({ id: i, name: (userById(db, i) || {}).name || i })),
      actions: uniq(db.audit.map((a) => a.action)),
      entityTypes: uniq(db.audit.map((a) => a.entityType)),
    },
  };
}

export function systemLog(db, actor, { level } = {}) {
  requireRole(actor, 'organizer');
  return db.syslog.filter((x) => !level || level === 'all' || x.level === level).sort((a, b) => b.ts - a.ts).map((x) => ({ ...x }));
}
