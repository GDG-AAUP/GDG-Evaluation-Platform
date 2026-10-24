// Fixed monthly scorecard (15 categories, total max 100).
// IMMUTABLE BY DESIGN: this is NOT a policy flag and cannot be edited from the
// Policies page. Changing it is a code change + a data migration.
//   cat1..cat5   : integer 0..10  (core, 50 points)
//   cat6..cat15  : integer 0..5   (50 points)

export const SCORECARD_CATEGORIES = Object.freeze([
  { id: 'cat1', label: 'الحضور والانضباط بالمواعيد', max: 10 },
  { id: 'cat2', label: 'الالتزام وتحمل المسؤولية', max: 10 },
  { id: 'cat3', label: 'إنجاز وتسليم المهام في الوقت المحدد', max: 10 },
  { id: 'cat4', label: 'جودة العمل ودقة التنفيذ', max: 10 },
  { id: 'cat5', label: 'العمل الجماعي والتعاون مع الفريق', max: 10 },
  { id: 'cat6', label: 'التواصل الفعّال مع الفريق والمسؤولين', max: 5 },
  { id: 'cat7', label: 'المبادرة وتقديم الأفكار الإبداعية', max: 5 },
  { id: 'cat8', label: 'المشاركة الفعّالة في الأنشطة والفعاليات', max: 5 },
  { id: 'cat9', label: 'المساهمة في تنظيم الفعاليات', max: 5 },
  { id: 'cat10', label: 'حل المشكلات والتعامل مع التحديات', max: 5 },
  { id: 'cat11', label: 'التعلم والتطوير المستمر', max: 5 },
  { id: 'cat12', label: 'الاحترافية واحترام الآخرين', max: 5 },
  { id: 'cat13', label: 'سد مكان زميل آخر وتغطية مهامه عند الغياب أو الحاجة', max: 5 },
  { id: 'cat14', label: 'توثيق الأعمال ومتابعة الإنجازات', max: 5 },
  { id: 'cat15', label: 'الحفاظ على سرية المعلومات والتمثيل المسؤول للنادي', max: 5 },
].map((c) => Object.freeze(c)));

export const SCORECARD_MAX = 100;
export const CORE_COUNT = 5;

/**
 * Validates a scorecard. Accepts an object {cat1..cat15}. Every category must be
 * EXPLICITLY scored (0 is a valid explicit score; missing/empty/null is not).
 * Returns { ok, scores, total, core, errors: {catId: message} }.
 */
export function validateScorecard(input) {
  const errors = {};
  const scores = {};
  const src = input && typeof input === 'object' ? input : {};
  SCORECARD_CATEGORIES.forEach((c) => {
    const raw = src[c.id];
    if (raw === undefined || raw === null || raw === '') { errors[c.id] = 'هذا البند مطلوب (0 مسموح).'; return; }
    const v = typeof raw === 'number' ? raw : (/^\s*\d+\s*$/.test(String(raw)) ? Number(raw) : NaN);
    if (!Number.isInteger(v)) { errors[c.id] = 'أدخل عددًا صحيحًا.'; return; }
    if (v < 0 || v > c.max) { errors[c.id] = `المدى المسموح 0 إلى ${c.max}.`; return; }
    scores[c.id] = v;
  });
  const extra = Object.keys(src).filter((k) => !SCORECARD_CATEGORIES.some((c) => c.id === k));
  if (extra.length) errors._extra = 'بنود غير معروفة في بطاقة التقييم.';
  const ok = Object.keys(errors).length === 0;
  const total = ok ? scoreTotal(scores) : null;
  return { ok, scores: ok ? scores : null, total, core: ok ? coreTotal(scores) : null, errors };
}

export const scoreTotal = (s) => SCORECARD_CATEGORIES.reduce((a, c) => a + (s[c.id] || 0), 0);
export const coreTotal = (s) => SCORECARD_CATEGORIES.slice(0, CORE_COUNT).reduce((a, c) => a + (s[c.id] || 0), 0);
