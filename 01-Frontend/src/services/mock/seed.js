// Deterministic demo data (3 months, 2 campuses x 4 teams, 48 members).
// Demo accounts (password 123456): member@gdg.ps = u1, manager@gdg.ps = m1,
// organizer@gdg.ps = o1.

import { DEFAULT_POLICIES } from '../../lib/constants.js';
import { nextMonth } from '../../lib/format.js';
import { buildLegacyRows, uid } from './helpers.js';

const TEAM_NAMES = ['Technical', 'PR', 'Marketing', 'Social Media'];

const FIRST = ['ليان', 'يوسف', 'رنا', 'عمر', 'سارة', 'أحمد', 'مها', 'خالد', 'دانا', 'محمد', 'نور', 'إبراهيم', 'هبة', 'طارق', 'آية', 'كريم', 'لانا', 'بشار', 'جنى', 'سامر', 'رند', 'زياد', 'ميس', 'حمزة', 'تالا', 'ياسمين', 'علي', 'ديما', 'قيس', 'رهف', 'معتز', 'شهد', 'أسيل', 'فادي', 'منى', 'ليث', 'ريم', 'وسام', 'هديل', 'عدي', 'جود', 'نادر', 'سلمى', 'عبدالله', 'رزان', 'مجد', 'ميرا', 'فراس'];
const LAST = ['أبو سعدة', 'حمدان', 'الخطيب', 'نصار', 'شلبي', 'دراغمة', 'قاسم', 'عودة', 'سليمان', 'جبر', 'صالح', 'حداد', 'زيدان', 'منصور', 'عيسى', 'كنعان', 'غانم', 'توفيق', 'البرغوثي', 'عبدالله', 'ريان', 'خليل', 'طه', 'حسن'];
const MGR = ['بشار قاسم', 'مها عودة', 'خالد شلبي', 'دانا حداد', 'سامر جبر', 'نور زيدان', 'طارق كنعان', 'هديل غانم'];

/** Timestamp inside a month ("2026-10", day, hour). */
const D = (m, d, h) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, d, h || 10, (d * 7) % 60).getTime();
};

const MONTH_AR = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
const mLabel = (m) => { const [y, mo] = m.split('-'); return `${MONTH_AR[+mo - 1]} ${y}`; };

export function createSeed() {
  const BASE = new Date(2026, 9, 13, 19, 0).getTime(); // the "current" demo moment
  const db = {
    v: 2, demo: true, scorecards: [], awards: {}, news: defaultNews(),
    users: [], teams: [], entries: [], evals: {},
    criteria: [{ n: 'الالتزام والانضباط', w: 30 }, { n: 'متابعة الفريق', w: 30 }, { n: 'التواصل والتعاون', w: 20 }, { n: 'نتائج الفريق', w: 20 }],
    audit: [], syslog: [], months: [], snaps: {}, corrections: [],
    policies: { ...DEFAULT_POLICIES },
    curMonth: '2026-10', seq: 1000,
    clockOffset: BASE - Date.now(),
  };
  const U = (id) => db.users.find((u) => u.id === id);

  let s = 11;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const R = (n) => Math.floor(rnd() * n);

  ['jenin', 'ramallah'].forEach((c) => TEAM_NAMES.forEach((t) => {
    db.teams.push({ id: `${c}-${t.toLowerCase().replace(' ', '-')}`, campus: c, name: t, status: 'active' });
  }));

  const used = new Set();
  let k = 0;
  let mi = 0;
  db.users.push({ id: 'o1', name: 'هبة منصور', email: 'organizer@gdg.ps', pass: '123456', role: 'organizer', campus: 'jenin', teams: [], status: 'active', created: D('2026-08', 1) });
  db.users.push({ id: 'o2', name: 'عدي البرغوثي', email: 'organizer2@gdg.ps', pass: '123456', role: 'organizer', campus: 'ramallah', teams: [], status: 'active', created: D('2026-08', 1) });

  db.teams.forEach((t) => {
    mi += 1;
    const mid = `m${mi}`;
    db.users.push({ id: mid, name: MGR[mi - 1], email: mid === 'm1' ? 'manager@gdg.ps' : `${mid}@gdg.ps`, pass: '123456', role: 'manager', campus: t.campus, teams: [t.id], status: 'active', created: D('2026-08', 2) });
    for (let j = 0; j < 6; j += 1) {
      let name = `${FIRST[k % FIRST.length]} ${LAST[(k * 5 + 3) % LAST.length]}`;
      let x = 0;
      if (k === 0) name = 'ليان أبو سعدة';
      while (used.has(name)) { x += 1; name = `${FIRST[(k + x) % FIRST.length]} ${LAST[(k * 5 + 3 + x) % LAST.length]}`; }
      used.add(name);
      k += 1;
      db.users.push({ id: `u${k}`, name, email: k === 1 ? 'member@gdg.ps' : `u${k}@gdg.ps`, pass: '123456', role: 'member', campus: t.campus, teams: [t.id], status: 'active', created: D('2026-08', 3) });
    }
  });

  const mgrOf = (tid) => db.users.find((u) => u.role === 'manager' && u.teams.includes(tid)).id;
  U('u31').status = 'disabled';
  U('u13').status = 'deleted';

  const KINDS = [['حضور ورشة', 10], ['إنجاز عمل', 20], ['مشاركة فعّالة', 5], ['تنظيم فعالية', 15], ['مساهمة بمحتوى', 8], ['تأخر عن الاجتماع', -5], ['غياب بدون عذر', -10]];
  const push = (userId, month, day, value, reason, actor, extra) => {
    db.entries.push({ id: uid(db, 'e'), userId, month, ts: D(month, day, 9 + R(8)), value, reason, actor, reverses: null, ...(extra || {}) });
  };

  ['2026-08', '2026-09', '2026-10'].forEach((m) => {
    const maxd = m === '2026-10' ? 12 : 27;
    db.users.filter((u) => u.role === 'member').forEach((u) => {
      if (u.id === 'u1' && m === '2026-10') return;
      const n = 3 + R(3);
      for (let i = 0; i < n; i += 1) {
        const kd = KINDS[R(7)];
        const neg = kd[1] < 0 && R(3) > 0;
        const kk = neg ? KINDS[R(5)] : kd;
        push(u.id, m, 1 + R(maxd), kk[1], kk[0], mgrOf(u.teams[0]));
      }
    });
  });

  // u1 (the demo member): a readable story incl. one reversal.
  push('u1', '2026-10', 8, 10, 'حضور ورشة Flutter', 'm1');
  push('u1', '2026-10', 5, 20, 'إنجاز تصميم الشعار', 'm1');
  push('u1', '2026-10', 3, -5, 'تأخر عن الاجتماع', 'm1');
  const badE = db.entries[db.entries.length - 1];
  db.entries.push({ id: uid(db, 'e'), userId: 'u1', month: '2026-10', ts: D('2026-10', 4, 12), value: 5, reason: 'عكس عملية: تأخر عن الاجتماع', actor: 'o1', reverses: badE.id });

  // Force an exact tie between u2 and u3 so the tie-break is visible.
  const tot = (id, m) => db.entries.filter((e) => e.userId === id && e.month === m).reduce((a, e) => a + e.value, 0);
  const d = tot('u2', '2026-10') - tot('u3', '2026-10');
  if (d !== 0) {
    db.entries.push({ id: uid(db, 'e'), userId: d > 0 ? 'u3' : 'u2', month: '2026-10', ts: D('2026-10', 11, 15), value: Math.abs(d), reason: 'مساهمة بمحتوى', actor: 'm1', reverses: null });
  }
  db.entries.sort((a, b) => a.ts - b.ts);

  db.months = [{ id: '2026-08', status: 'archived' }, { id: '2026-09', status: 'archived' }, { id: '2026-10', status: 'open' }];
  ['2026-08', '2026-09'].forEach((m) => { db.snaps[m] = { month: m, closedAt: D(nextMonth(m), 1, 8), kind: 'legacy', rows: buildLegacyRows(db, m) }; });
  db.corrections.push({ id: uid(db, 'c'), month: '2026-09', userId: 'u2', value: 5, reason: 'نقاط حضور لم تُسجَّل في وقتها', actor: 'o1', ts: D('2026-10', 3, 13) });

  const A = (a, ac, et, en, b, af, r, day) => db.audit.push({ id: uid(db, 'a'), actor: a, action: ac, entityType: et, entity: en, before: b, after: af, reason: r || '', ts: D('2026-10', day, 11) });
  A('o1', 'إضافة نقاط', 'نقاط', 'يوسف حمدان', '0', '+10', 'حضور ورشة', 9);
  A('m1', 'إضافة نقاط', 'نقاط', 'ليان أبو سعدة', '10', '30', 'إنجاز عمل', 5);
  A('o1', 'عكس عملية نقاط', 'نقاط', 'ليان أبو سعدة', '-5', '0', 'تصحيح خطأ بالتسجيل', 4);
  A('o1', 'تعطيل حساب', 'عضو', 'عضو من فريق PR', 'نشط', 'معطّل', 'طلب من المدير', 7);
  A('o1', 'حذف ناعم', 'عضو', 'عضو من فريق Marketing', 'نشط', 'محذوف', 'انسحاب من الفريق', 8);
  A('o2', 'إسناد مدير لفريق', 'فريق', 'Technical - رام الله', '—', 'سامر جبر', 'تعيين جديد', 2);
  db.audit.sort((a, b) => b.ts - a.ts);

  [['info', 'تسجيل دخول ناجح', 'auth', '2026-10-12'], ['warning', 'محاولة دخول فاشلة متكررة', 'auth', '2026-10-12'], ['error', 'تعذر الاتصال بقاعدة البيانات (إعادة محاولة)', 'db', '2026-10-11'], ['info', 'اكتمل النسخ الاحتياطي اليومي', 'backup', '2026-10-11'], ['warning', 'طلب بطيء على Leaderboard (1.8s)', 'api', '2026-10-10'], ['error', 'فشل إرسال إشعار', 'notify', '2026-10-09'], ['info', `إغلاق شهر ${mLabel('2026-09')}`, 'archive', '2026-10-01'], ['warning', 'رفض وصول: Member إلى مسار إداري', 'authz', '2026-10-08']]
    .forEach((x, i) => db.syslog.push({ id: uid(db, 's'), level: x[0], msg: x[1], src: x[2], ts: new Date(`${x[3]}T${String(8 + i).padStart(2, '0')}:15:00`).getTime() }));
  db.syslog.sort((a, b) => b.ts - a.ts);

  const ev = (id, sc, st) => { (db.evals['2026-10'] = db.evals['2026-10'] || {})[id] = { scores: sc, status: st }; };
  ev('m1', [85, 80, 90, 75], 'approved');
  ev('m2', [70, 65, 80, 60], 'draft');
  ev('m5', [88, 92, 85, 90], 'approved');

  // Clearly labelled demo scorecards, never created by a migration of real saved data.
  db.users.filter(u => u.role === 'member' && u.status === 'active').forEach((u, i) => {
    const scores = Object.fromEntries(Array.from({length:15}, (_,j) => [`cat${j+1}`, Math.max(0,(j<5?10:5)-((i+j)%4))]));
    db.scorecards.push({id:uid(db,'sc'), targetId:u.id, month:db.curMonth, scores,
      total:Object.values(scores).reduce((a,b)=>a+b,0), core:Object.values(scores).slice(0,5).reduce((a,b)=>a+b,0),
      actor:mgrOf(u.teams[0]), rev:1, ts:D(db.curMonth, 10, 9)+i*1000, reason:'تقييم تجريبي للتوضيح'});
  });
  return db;
}

/** Editable SAMPLE news (drafts). Not real events — replace from the organizer panel. */
export function defaultNews() {
  return [
    { id: 'n1', title: 'خبر نموذجي (مسودة)', body: 'هذا نص تجريبي. استبدله بخبر حقيقي عن مجتمع GDG في الجامعة العربية الأمريكية.', status: 'draft', date: '2026-10-01' },
  ];
}
