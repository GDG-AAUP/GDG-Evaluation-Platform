# GDG Evaluation Platform — Frontend (React)

واجهة كاملة بالعربية (RTL) بألوان GDG: Member / Manager / Organizer، تعمل الآن على **mock backend**
مدمج، وجاهزة للتحويل إلى الـ API الحقيقي بتغيير متغيّر بيئة واحد.

## التشغيل
```bash
npm install
npm run dev            # Vite على http://localhost:5173
npm run build          # بناء Vite إلى dist/
npm test               # اختبارات منطق الـ mock (node:test)
```
بدون Vite (بيئات محدودة): `npm run build:single` ينتج `dist-single/gdg-evaluation.html` ملفًا واحدًا يعمل بالضغط المزدوج.

**حسابات تجريبية** (كلمة المرور `123456`): `member@gdg.ps` · `manager@gdg.ps` · `organizer@gdg.ps`.
زر «وضع العرض» أسفل الشاشة يبدّل الأدوار ويحاكي الأخطاء وانتهاء الجلسة ويعيد ضبط البيانات.

## الربط بالـ API الحقيقي (مهمة مطوّر الـ Backend + هزار)
1. انسخ `.env.example` إلى `.env.local` وضع `VITE_USE_MOCK=false` و`VITE_API_URL`.
2. نفّذ المسارات الموصوفة في `docs/API_CONTRACT.md` (نفس الأشكال بالضبط).
3. الواجهة لا تتغير: كل الاستدعاءات تمر عبر `src/services/*.js` → `api(mockFn, httpFn)`.
4. إن اختلف شكل استجابة، عدّله في ملف الخدمة المعني فقط (لا في الصفحات).

## البنية
```
src/
  main.jsx, App.jsx, routes.jsx     نقطة الدخول + جدول المسارات والصلاحيات
  router/                           راوتر hash خفيف + Link
  context/                          Auth · Theme · Toast · AppData(سياسات + أشهر + فرق)
  hooks/                            useAsync (loading/error/reload) · useDebounced
  lib/                              constants · permissions(Permission Matrix) · nav · format · policyMeta
  components/ui/                    Button/Badges/Form/Dialog/DataTable/States(Async,Empty,Error,403,404)
  components/layout/                AppShell · Header · Sidebar · BottomTabs · DemoPanel
  components/domain/                AddPointsDialog · UserDialog
  pages/                            Login · Leaderboard · MyPoints · Assistant
  pages/manager/                    ManagerDashboard
  pages/organizer/                  11 صفحة (نظرة عامة … السياسات)
  services/                         طبقة الـ API (+ mock/ : seed · engine · engineAdmin · runtime · اختبارات)
  styles/                           tokens.css (ألوان GDG) · app.css
```

## توزيع العمل (حسب مهام الفريق)
**قصي (Phase 1):** هيكل المشروع ✔ · Layout/Navigation/Routing ✔ · Login + Dashboard layout ✔ · مكوّنات قابلة لإعادة الاستخدام ✔ ·
API Service Layer + mock data ✔ · Responsive + RTL ✔.
**هزار (Phase 2):** شاشات Member/Manager/Organizer ✔ · الأعضاء/الفرق/النقاط ✔ · Leaderboard ✔ · تقييم المديرين ✔ · الأرشيف ✔ ·
Loading/Error/Empty ✔ · ربط الـ APIs (جاهز للتبديل، ينتظر Backend) · إصلاح ملاحظات الاختبار (ينتظر تقارير الـ QA).

## قواعد العمل المطبّقة (ومغطّاة باختبارات)
سجل نقاط append-only وسبب إلزامي وعكس مرتبط · المدير لا يضيف لنفسه ولا يخرج عن فريقه · لا تغيير أدوار للمدير ·
الإغلاق الشهري = لقطة ثابتة وشهر جديد من الصفر · تعادل = من وصل أولًا · تقييم المديرين منفصل ومقفل بعد الاعتماد ·
حذف ناعم + استرجاع · حماية آخر Organizer · Audit Log منفصل عن System Logs · تصحيحات متأخرة للأشهر المؤرشفة ·
المساعد محصور بصلاحيات الدور · القرارات الإدارية المفتوحة كأعلام في صفحة «السياسات».

## الروابط السريعة (واتساب، To-Do …)
تُضبط في ملف واحد `src/links.config.js` (رابط + أيقونة لكل عنصر). تظهر في الهيدر (أيقونة 🔗) وفي القائمة الجانبية، وتفتح في تبويب جديد.

## حدود صريحة
- **لا يوجد Backend حقيقي** بعد: الاتصال الحقيقي مكتوب (`services/http.js`) لكنه **غير مجرَّب** ضد خادم فعلي.
- بيانات الـ mock تُحفظ في localStorage للمتصفح فقط.
- مسار **Vite** (`npm run dev/build`) لم يُجرَّب في بيئة البناء لأن تثبيت الحزم كان محظورًا؛ كل التحقق تم عبر esbuild
  (`build:single`) واختبارات Playwright على الملف الناتج. الشيفرة قياسية ويُتوقع أن تعمل مع Vite دون تعديل.
- الراوتر مكتوب يدويًا (hash) بدل react-router لنفس السبب؛ استبداله سهل لأن كل الاستخدام في `router/router.jsx`.
- شعار GDG placeholder؛ ضع الشعار الرسمي في `components/layout/Logo.jsx`.
- لا توجد ميزة مهام (أُزيلت بقرار)، والإشعارات الفعلية غير مفعّلة.
