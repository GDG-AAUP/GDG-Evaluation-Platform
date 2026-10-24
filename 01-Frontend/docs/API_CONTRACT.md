# عقد الـ API — GDG Evaluation Platform

> تحديث v2: اقرأ `RATINGS_API.md` أولًا للتقييم الجديد من 15 بندًا، والتكريم والأخبار والصور. مسارات النقاط وتقييم المديرين أدناه محفوظة كميزات قديمة مستقلة؛ ترتيب الشهر الجاري يعتمد على أحدث بطاقة تقييم.

هذا هو العقد الذي تتوقعه الواجهة. الـ mock (`src/services/mock/`) ينفّذه بالكامل ومغطّى باختبارات،
ومطوّر الـ Backend ينفّذ نفس المسارات والأشكال. للتحويل إلى الـ API الحقيقي:

```
VITE_USE_MOCK=false
VITE_API_URL=https://your-api.example.com/api
```

## قواعد عامة
- JSON فقط. التوثيق: `Authorization: Bearer <token>` (يُحفظ في sessionStorage؛ يُفضَّل لاحقًا httpOnly cookie).
- الأخطاء: HTTP status + جسم `{ "message": "<جملة عربية جاهزة للعرض>", "details": { "code": "..." } }`.
  - `400` تحقق من المدخلات · `401` غير مسجّل/انتهت الجلسة (الواجهة تفتح نافذة «انتهت جلستك»)
  - `403` غير مسموح (الواجهة تعرض صفحة الصلاحية) · `404` غير موجود · `409` تعارض مع قاعدة عمل
    (مثال `details.code = "LAST_ORGANIZER"`)
- **الصلاحيات تُفرض في الـ Backend** (RBAC) — إخفاء الأزرار في الواجهة ليس حماية.
- الوقت `ts`: milliseconds epoch. الشهر: `"YYYY-MM"`. الحرم: `jenin | ramallah`. الدور: `organizer | manager | member`.
- سجل النقاط **append-only**: لا تعديل ولا حذف؛ التصحيح بعملية عكسية مرتبطة. المجاميع تُحسب من السجل.

## الدخول
| Method | Path | Body | Response | الدور |
|---|---|---|---|---|
| POST | `/auth/login` | `{email,password}` | `{token,user}` | عام |
| POST | `/auth/logout` | — | 204 | أي |
| GET | `/auth/me` | — | `user` | أي |

`user = {id,name,email,role,campus,teams:[teamId],teamsLabel,status,created}`

## بيانات مرجعية وسياسات
| GET | `/meta` | → `{curMonth, months:[{id,status}], teams:[{id,campus,name,status}], criteria:[{n,w}]}` | أي |
|---|---|---|---|
| GET | `/policies` | → `{managerCanEditOrMoveMembers, membersInMultipleTeams, globalLeaderboardEnabled, maxPointsPerOperation, multipleManagersPerTeam}` | أي |
| PUT | `/policies/:key` | `{value}` → السياسات كاملة | Organizer |

## الترتيب
`GET /leaderboard?month&campus&teamId&global=true` → `{month, archived, rows:[{rank,userId,name,campus,teamId,teamName,teamsLabel,total,tie,isMe}]}`
- الترتيب: المجموع تنازليًا، وعند التعادل يُقارن مجموع cat1–cat5، ثم وقت آخر تقييم معتمد، ثم الاسم. الأشهر المؤرشفة تُقرأ من اللقطة.
- `global=true` يعيد `403` إذا كانت `globalLeaderboardEnabled=false`.

## النقاط
| Method | Path | Body / Query | Response | الدور |
|---|---|---|---|---|
| GET | `/points/mine?month` | | `{month,total,positive,negative,rank,entries:[Entry]}` | Member |
| GET | `/members/assignable` | | `[{id,name,campus,teams,teamsLabel,total}]` | Manager (فريقه) / Organizer |
| POST | `/points` | `{userId,value,reason}` | `{total,entry}` | Manager (فريقه) / Organizer |
| GET | `/points?month&campus&teamId&kind=pos|neg|rev` | | `[Entry]` | Organizer |
| POST | `/points/:id/reverse` | `{reason}` | `{ok:true}` | Organizer |

قواعد `POST /points`: السبب إلزامي؛ `value` عدد صحيح غير صفر و`|value| ≤ maxPointsPerOperation`؛
المدير لا يضيف لنفسه (403) ولا لعضو خارج فريقه (403)؛ العضو يجب أن يكون فعّالًا (409).
قواعد العكس: مرة واحدة فقط، لا عكس لعملية عكسية، لا عكس في شهر مؤرشف (409 → استخدم تصحيحًا متأخرًا).

`Entry = {id,userId,userName,campus,teamsLabel,month,ts,value,reason,actorId,actorName,actorRole,reverses,reversesReason,reversed,archived,canReverse}`

## لوحات
- `GET /teams/:id/overview` → `{team,month,metrics:{activeMembers,points},top:[Row],members:[{id,name,email,role,status,total,isMe}]}` — Manager لفريقه فقط وإلا 403؛ Organizer لأي فريق.
- `GET /overview` (Organizer) → `{month,members:{jenin,ramallah,total},managers,pointsAdded,perTeam:[{teamId,campus,name,points}],recent:[{id,action,entity,ts,actorName}]}`

## المستخدمون (Organizer، ما عدا الإضافة)
| Method | Path | Body |
|---|---|---|
| GET | `/users?role&campus&teamId&status&deleted=true` | |
| POST | `/users` | `{name,email,campus,role,teams,password}` — Manager: Member داخل فريقه فقط |
| PUT | `/users/:id` | `{name,email,campus,role,teams}` — Manager: فقط إذا `managerCanEditOrMoveMembers` |
| POST | `/users/:id/toggle-status` | `{reason}` (تعطيل/تفعيل) |
| DELETE | `/users/:id` | `{reason}` (حذف ناعم) |
| POST | `/users/:id/restore` | → يعود «معطّل» |

القواعد: البريد فريد (409)؛ لا تغيير دور/تعطيل/حذف للنفس (403)؛ **آخر Organizer فعّال محمي** (409 `LAST_ORGANIZER`)؛
`membersInMultipleTeams=false` ⇒ فريق واحد للعضو؛ الحذف الناعم يُبقي السجلات.

## الفرق
- `GET /teams` → `[{id,campus,name,status,managers:[{id,name}],activeMembers}]`
- `GET /managers?campus` → `[{id,name,teams}]`
- `POST /teams` / `PUT /teams/:id` ← `{campus,name,managerIds}` (اسم فريد داخل الحرم؛ مدير واحد إن `multipleManagersPerTeam=false`)
- `POST /teams/:id/toggle` ← `{reason}`

## تقييم المديرين (Organizer، منفصل لكل حرم)
- `GET /evaluations?campus` → `{period,criteria,rows:[{managerId,name,teamsLabel,score,status:none|draft|approved}]}`
- `GET /evaluations/:managerId` → `{manager,scores,status,score,criteria}`
- `PUT /evaluations/:managerId` ← `{scores:[0..100 int],approve}` — بعد الاعتماد يُقفل (409)
- `PUT /evaluations/criteria` ← `{criteria:[{n,w}]}` — مجموع الأوزان = 100

## الأرشيف (Organizer)
- `GET /archive` → `{curMonth,months:[{id,status}],corrections:[...],members:[{id,name,campus}]}`
- `POST /archive/close` → `{curMonth}` — يحفظ لقطة ثابتة ويفتح الشهر التالي من الصفر
- `GET /archive/:month?campus&teamId` → `{month,closedAt,rows:[Row]}`
- `POST /archive/corrections` ← `{month,userId,value,reason}` — لا تغيّر اللقطة

## السجلات (Organizer)
- `GET /audit?actorId&action&entityType&from&to` → `{items:[{id,actor,actorName,action,entityType,entity,before,after,reason,ts}],filters:{actors,actions,entityTypes}}`
- `GET /syslog?level=error|warning|info` → `[{id,level,msg,src,ts}]` (لا بيانات حساسة)

## المساعد
`POST /assistant` ← `{question}` → `{answer}` — يجيب ضمن صلاحيات الدور فقط (Member: بياناته، Manager: فريقه)،
ويرفض أي بيانات خارج النطاق أو تنفيذ إجراءات إدارية.
