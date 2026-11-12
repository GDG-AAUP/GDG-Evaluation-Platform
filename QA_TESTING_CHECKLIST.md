# دليل الفحص والاختبار الميداني — QA Testing Checklist

End-to-end checks to run on the **live** deployment (see [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md)). Tick each box and record anything unexpected in the **Bug log** at the end, with a screenshot and the time.

**How to read each line:** *Steps* → **Expected** result. Arabic labels are the exact texts on screen.

---

## 0. Setup (prepare test data once)

### Accounts (each one a separate Clerk sign-up with a real, verified email)

| Code | Role | Campus / team | Used for |
|------|------|---------------|----------|
| **O1** | Organizer (bootstrap, see the deployment guide §0.3) | — | main organizer |
| **O2** | Organizer (promoted by O1) | — | the second organizer and the self-lockout tests |
| **MG-J** | Manager | Jenin / team **QA-Tech** | manager flows |
| **MG-R** | Manager | Ramallah / team **QA-Media** | cross-team checks |
| **MB-J1**, **MB-J2** | Member | Jenin / QA-Tech | member flows and ties |
| **MB-R1** | Member | Ramallah / QA-Media | separate boards |

Use a different browser profile or a private window per account so sessions don't mix.

### Tools

- Desktop Chrome with DevTools open: the **Console** tab and the **Network** tab with *Preserve log* ticked.
- A phone (Android or iPhone), or DevTools device mode at 375 × 812.

### API helper for checks that have no button (run in the DevTools Console while signed in)

```js
// Calls the live API as the signed-in user.
const API = 'https://<backend-domain>/api';        // ← replace
const call = async (method, path, body, extra = {}) => {
  const token = await window.Clerk.session.getToken();
  const r = await fetch(API + path, { method, headers: { Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json', ...extra }, body: body ? JSON.stringify(body) : undefined });
  console.log(method, path, r.status, await r.json().catch(() => null)); return r.status;
};
```

---

## 1. Organizer flows — مسار المنظّم

### 1.1 Teams: create, active / inactive (الحرمان والفرق)

- [ ] Open **الحرمان والفرق** → **Expected:** two campuses, **جنين** (Jenin) and **رام الله** (Ramallah).
- [ ] Under Jenin, click **فريق جديد** (new team), name it `QA-Tech` and save → **Expected:** the team appears with the badge **معطّل** (inactive), since new teams start inactive with no manager.
- [ ] Click **تفعيل** (activate) on a team with **no manager** → **Expected:** refused with a clear Arabic message. A team needs a manager to be active.
- [ ] Create `QA-Media` under Ramallah the same way.
- [ ] Click **تعديل** (edit) on QA-Tech, rename it to `QA-Tech 2` and save, then rename it back → **Expected:** saved, and an entry appears in **سجل التدقيق** (audit log).
- [ ] After a manager is assigned (1.2), click **تفعيل** → **Expected:** the badge changes to **فعّال** (active). Click **تعطيل** (deactivate), give a reason → **Expected:** **معطّل**.
- [ ] Create a second team with the **same name in the same campus** → **Expected:** refused (team already exists). The same name in the other campus is allowed.

### 1.2 Members, Managers and Organizers (الأعضاء / طلبات الانضمام / المديرون)

- [ ] A new account signs up → **Expected:** they see "waiting for organizer approval". O1 opens **طلبات الانضمام** (join requests) → the request is listed.
- [ ] Approve MB-J1 as a **Member** of QA-Tech → **Expected:** MB-J1 reloads and gets the Member menu. Repeat for MB-J2 and MB-R1 (QA-Media).
- [ ] Reject one test request with a reason → **Expected:** that person sees "rejected" and has no access.
- [ ] Make MG-J **Manager** of QA-Tech, from the team's **تعديل** dialog or by editing the user's role → **Expected:** **المدير: MG-J** is shown on the team card.
- [ ] Try to make MG-R a Manager of QA-Tech too (the seat is taken) → **Expected:** refused with "the team already has a manager", and nothing changes.
- [ ] Remove the manager from an **active** team without a replacement → **Expected:** refused. An active team needs a manager.
- [ ] Promote O2 to **Organizer** → **Expected:** O2 gets the Organizer menu after reloading.
- [ ] In **الأعضاء**, open the **المنظّمون** (organizers) tab → **Expected:** every organizer is listed (O1, O2), active and inactive.
- [ ] **Demote an organizer:** as O1, edit O2 and change the role to **عضو** (member) → **Expected:**
  - the dialog warns that organizer rights will be removed
  - saving **without a team** is refused
  - with campus Jenin and team QA-Tech, it saves with the message **تم تغيير الدور وحفظ التعديلات** (role changed and changes saved)
  - O2's menu becomes the Member menu after reloading
- [ ] Promote O2 back to Organizer for the next tests.
- [ ] **Deactivate and reactivate another organizer:** O1 deactivates O2 → O2 loses access → **Expected:** O2 is still listed in **المنظّمون** as inactive. Reactivate → access returns.
- [ ] **Self-lockout protection (UI):** on O1's own row → **Expected:**
  - there is no deactivate or delete button
  - in the edit dialog the role is locked, with a note that another organizer must change it
  - O1 can still edit their own name
- [ ] **Self-lockout protection (server):** as O1, run in the console (replace `<O1-id>` with O1's user ID from the Network tab):
  ```js
  await call('PATCH', '/users/<O1-id>', { role: 'member', teamId: 1, reason: 'QA' });
  await call('PATCH', '/users/<O1-id>/status', { isActive: false });
  await call('DELETE', '/users/<O1-id>', { reason: 'QA' });
  ```
  **Expected:** all three return `409` with `SELF_LOCKOUT`, and O1 still has access.
- [ ] **Last organizer:** with O2 deactivated, O1 is the only active organizer, and no path can remove the last one → **Expected:** the calls above still return 409, and O1 stays an Organizer.

### 1.3 Manager evaluations, 0–100 (تقييم المدراء)

- [ ] Open **تقييم المدراء** → **Expected:**
  - managers are listed
  - the four fixed criteria are shown with their weights
- [ ] Evaluate MG-J with the name `تقييم QA 1`, today's date, and four scores between 0 and 100 → **Expected:**
  - the weighted score appears live, before saving
  - after saving, a message shows **النتيجة المرجّحة** (the weighted score)
- [ ] Add a **second** and a **third** evaluation for MG-J in the same month → **Expected:**
  - each one is saved as a new entry (none overwrites another)
  - the monthly average updates
- [ ] Enter `101`, `-1`, an empty score, or no name → **Expected:** refused with **أكمل الحقول … 4 درجات من 0 إلى 100** ("fill in the fields … four scores from 0 to 100").
- [ ] **سجل التدقيق** → **Expected:** each evaluation is logged with the reason `Manager evaluation: <name> (<date>)`.

### 1.4 Points: add and reverse (إضافة نقاط)

- [ ] As O1, open **إضافة نقاط** (add points) → **Expected:** active Members **and** Managers from both campuses are listed.
- [ ] Give MB-J1 `+10` with an activity name and a reason → **Expected:**
  - the success message appears
  - a green banner shows the award
  - the entry appears in **سجل النقاط التي أضفتها** ("points log I added") with the date, activity, reason and **أنت** ("you")
- [ ] **Reverse a point entry (UI).** In **سجل النقاط التي أضفتها**, click **عكس العملية** on the `+10` entry → **Expected:** a confirmation dialog shows:
  - the member's name
  - the points (`+10`)
  - the activity
  - a required **سبب العكس** (reversal reason) field
- [ ] Click **عكس العملية** in the dialog with the reason empty → **Expected:** refused with **سبب العكس إلزامي.** ("a reversal reason is required"); nothing is sent.
- [ ] Enter a reason and confirm → **Expected:**
  - the toast **تم عكس العملية وتحديث المجاميع** ("reversal done and totals updated")
  - the log refreshes at once: the original entry shows **معكوسة** (reversed), and a new `−10` entry shows **عكس عملية** (reversal entry)
  - the metric cards and MB-J1's total drop by 10
- [ ] **Expected:** neither the reversed entry nor the reversal entry has a **عكس العملية** button any more.
- [ ] **Already reversed elsewhere:** open the page in two tabs, reverse the same entry in tab A, then confirm it in tab B → **Expected:** tab B shows **هذه العملية معكوسة مسبقًا.** ("already reversed") and the log refreshes.
- [ ] **سجل التدقيق** → **Expected:** the reversal has before and after values (the original entry and the reversal).

### 1.5 Close and correct a month (الأرشيف الشهري)

> ⚠️ Closing a month **cannot be undone**: it freezes that month's ranking. On the live server, coordinate with the product owner first, or run this on a staging copy.
>
> **Timing rules:**
> - Only a month that has **ended** can be closed. The month marked **مفتوح** is the oldest month not yet closed (usually last month); the running calendar month is refused with `MONTH_NOT_ENDED`.
> - Corrections apply to a **past** month and only to people who **belonged to a team during that month**.
> - On a brand-new deployment, accounts created this month have no team history in earlier months, so a correction for them is refused with `NO_TEAM_IN_MONTH`. That is expected.
> - To test corrections with real data, run 1.5 and 2.5 early next month, against the points added during this test cycle.

- [ ] Open **الأرشيف الشهري** (monthly archive) → **Expected:** the oldest unclosed past month is listed as **مفتوح** (open).
- [ ] Click **إغلاق الشهر** (close month) and confirm → **Expected:**
  - that month becomes **مؤرشف** (archived)
  - **عرض اللقطة** (view snapshot) shows the frozen ranking per campus and team
  - points added in the current month don't change it
- [ ] Try closing again while only the running calendar month is left → **Expected:** refused (`MONTH_NOT_ENDED`, "the month hasn't ended").
- [ ] In the snapshot, filter by **الحرم** (campus) and **الفريق** (team) → **Expected:** rows match; ties are marked **تعادل** (tie).
- [ ] Click **تصحيح** (correct) → choose the archived month and MB-J1, enter `5`, leave the reason empty → **Expected:** refused with **سبب التصحيح إلزامي** ("a correction reason is required").
- [ ] Enter `0` or `150` → **Expected:** refused (must be −100…100 and nonzero).
- [ ] Enter `5` with a reason → **Expected:**
  - **تم تسجيل التصحيح وإعادة احتساب ترتيب الشهر** ("correction recorded and the month's ranking recalculated")
  - the snapshot updates
  - the correction appears under **التصحيحات المتأخرة** (late corrections)
- [ ] **سجل التدقيق** → **Expected:** `CLOSED_MONTH_CORRECTION` and `MONTHLY_RANKING_REVISED` entries with before and after values.

### 1.6 Audit and system logs (سجل التدقيق / سجل النظام)

- [ ] **سجل التدقيق** → **Expected:**
  - every action above is listed with actor, time (Asia/Hebron), reason and old/new values
  - filters work
- [ ] **سجل النظام** (system log) → **Expected:** it loads, with no errors from your actions.

---

## 2. Manager flows — مسار المدير (sign in as MG-J)

### 2.1 Award points (إضافة نقاط)

- [ ] Open **إضافة نقاط** → **Expected:** only QA-Tech members are listed; nothing from other teams or campuses.
- [ ] Award `+15` to MB-J1, with an activity and a reason → **Expected:** success, plus a banner with MB-J1's month total and the team total.
- [ ] Award `-5` to MB-J2 → **Expected:** saved; shown as negative.
- [ ] **Range and required fields:** try each of these:
  - `0`
  - `101`
  - `-101`
  - `2.5`
  - an empty activity
  - an empty reason
  
  **Expected:** each is refused with **أدخل نقاطًا صحيحة (من -100 إلى 100، بدون صفر) واسم النشاط والسبب** ("enter valid points (−100 to 100, nonzero), the activity name and the reason").
- [ ] Boundaries: `100` and `-100` → **Expected:** both accepted.
- [ ] **Out of scope (server):** in the console, award points to MB-R1 (another team):
  ```js
  await call('POST', '/points', { userId: <MB-R1-id>, points: 5, activityName: 'QA', reason: 'QA' });
  ```
  **Expected:** `403`; nothing recorded.

### 2.2 Duplicate-submission protection

- [ ] **Double click:** open the dialog for MB-J1, fill it in, and double-click **إضافة** (add) fast → **Expected:** only **one** entry in the log.
- [ ] **Same award twice within 10 seconds:** submit `+3 / نشاط QA / سبب QA` for MB-J1, then immediately submit the same values again → **Expected:** the second one is refused as a duplicate (409, with an Arabic message); the log has one entry.
- [ ] Wait more than 10 seconds and submit the same award again → **Expected:** accepted, because a deliberate repeat after the window is allowed.
- [ ] **Retry with the same key (server):**
  ```js
  const k = { 'Idempotency-Key': 'qa-' + Date.now() };
  await call('POST', '/points', { userId: <MB-J1-id>, points: 2, activityName: 'Idem', reason: 'QA' }, k);
  await call('POST', '/points', { userId: <MB-J1-id>, points: 2, activityName: 'Idem', reason: 'QA' }, k);
  ```
  **Expected:** first `201`, second `200` with the same entry (replayed); one entry only. The same key with **different** values → `409`.

### 2.3 Team points log (سجل النقاط المضافة للفريق)

- [ ] Below the members on **إضافة نقاط** → **Expected:**
  - the card **سجل النقاط المضافة للفريق — QA-Tech (month)** ("points added to the team")
  - three metric cards: team total, number of entries, and points you added
  - the per-member totals line
- [ ] **Expected:** entries recorded by the **Organizer** for QA-Tech members also appear, with the organizer's name under **بواسطة** ("by").
- [ ] **Expected:** no entries from QA-Media.
- [ ] Have O1 add points to MB-J2 in another window and wait up to 30 seconds → **Expected:** the log refreshes by itself.

### 2.4 Reverse team points (عكس العملية)

- [ ] In **سجل النقاط المضافة للفريق**, click **عكس العملية** on a team member's entry, including one recorded by the **Organizer** → **Expected:**
  - the dialog shows the name, points and activity, with the required **سبب العكس** field
  - after confirming: the toast **تم عكس العملية وتحديث المجاميع**
  - the log, team total, **نقاط أضفتها أنت** ("points you added") and per-member totals update immediately
- [ ] **Expected:** there is no **عكس العملية** button on:
  - entries marked **معكوسة** (already reversed)
  - entries marked **عكس عملية** (reversal entries)
  - entries where **MG-J is the recipient** (a manager can't reverse their own points)
- [ ] **Server check, out of scope:** reverse another team's entry (an MB-R1 entry) through the console:
  ```js
  await call('POST', '/points/<MB-R1-entryId>/reverse', { reason: 'QA' });
  ```
  **Expected:** `403`; nothing changes.

### 2.5 Correct closed months, own team only (تصحيح الأشهر المغلقة)

*Needs a closed month (1.5) in which QA-Tech members already belonged to the team (see the timing rules in 1.5).*

- [ ] Open **تصحيح الأشهر المغلقة** (closed-month corrections) → **Expected:**
  - the closed months and the **تصحيح** button are shown
  - **no** **إغلاق الشهر** button (closing is organizer-only)
- [ ] In the correction dialog → **Expected:** only QA-Tech people can be chosen. Save `+4` with a reason → recorded, and the snapshot updates.
- [ ] Correct MB-R1 (another team) through the API:
  ```js
  await call('POST', '/archive/corrections', { month: '<YYYY-MM of the closed month>', userId: <MB-R1-id>, value: 4, reason: 'QA' });
  ```
  **Expected:** `403 FORBIDDEN`; nothing recorded. Correcting **MG-J themselves** is also `403`.

### 2.6 AI chatbot (المساعد)

- [ ] «كيف أضيف نقاطًا لعضو؟» ("How do I add points to a member?") → **Expected:** step-by-step instructions within about 2 seconds (a quick answer that doesn't need the AI).
- [ ] «كم نقاطي هذا الشهر؟» ("How many points do I have this month?") → **Expected:** MG-J's own month total, matching **تقييمي العام**.
- [ ] «كم مجموع نقاط فريقي هذا الشهر؟» ("What is my team's total this month?") → **Expected:** **equals** the team total in **سجل النقاط المضافة للفريق**.
- [ ] Add points, then ask again → **Expected:** the new total (live data).
- [ ] A free question, such as «من الأول في فريقي؟» ("Who's first in my team?") → **Expected:** a correct answer within 25 seconds, **or**, if the Gemini quota is used up, the clear Arabic message **وصل المساعد إلى حد الاستخدام اليومي…** ("the assistant reached its daily usage limit"). Never a blank or generic error.
- [ ] Ask about another team's members' details → **Expected:** no data outside the manager's scope.

---

## 3. Member flows — مسار العضو (sign in as MB-J1)

### 3.1 Personal points (تقيمي العام)

- [ ] Open **تقيمي العام** ("my overall rating") → **Expected:**
  - every entry this month with date, points, activity and reason
  - reversed entries are visible as reversed
  - the total matches what the manager and organizer saw
- [ ] Switch to a previous month, if available → **Expected:** that month's entries only.

### 3.2 Leaderboards: separate campuses and dense ranking (الترتيب)

- [ ] Open **الترتيب** (leaderboard) → **Expected:**
  - a campus choice of **جنين** or **رام الله**, plus a team filter
  - **no** combined or global board
- [ ] Jenin board → **Expected:** only Jenin people. **Managers are included** (MG-J appears with their points).
- [ ] Ramallah board → **Expected:** only Ramallah people (MB-R1, MG-R).
- [ ] **Dense ranking:** set up a tie, with MB-J1 and MB-J2 on equal points and MG-J lower (use O1 to adjust) → **Expected:** ranks `1, 1, 2`, never `1, 1, 3`.
- [ ] Team filter QA-Tech → **Expected:** only QA-Tech people, ranked the same way.

### 3.3 External links

- [ ] **Discord** quick link → **Expected:** opens `https://discord.com/invite/S8jvBycsJ6` in a **new tab**; the platform tab stays open.
- [ ] **Microsoft To Do** quick link → **Expected:** opens the shared To Do list invitation in a new tab.

### 3.4 Blocked actions

- [ ] **Expected:** the menu shows only the Member pages:
  - **صفحة المجتمع** (community page)
  - **تقييم الأداء** (performance rating)
  - **تقييم الأنشطة** (activity rating)
  - **الترتيب** (leaderboard)
  - **تقيمي العام** (my overall rating)
  - **المساعد** (assistant)
  
  There is **no** **إضافة نقاط**, archive, members or audit page.
- [ ] Type organizer and manager URLs directly into the address bar → **Expected:** an access-denied or not-found page; no data.
  - `/#/organizer/members`
  - `/#/organizer/audit`
  - `/#/give-points`
  - `/#/manager/archive`
- [ ] **Server:** in the console as MB-J1 →
  ```js
  await call('GET', '/users');
  await call('GET', '/audit');
  await call('GET', '/points/team-history');
  await call('POST', '/points', { userId: <MB-J2-id>, points: 5, activityName: 'x', reason: 'x' });
  await call('POST', '/archive/corrections', { month: '2026-01', userId: <MB-J2-id>, value: 5, reason: 'x' });
  await call('POST', '/points/<any-entryId>/reverse', { reason: 'x' });
  ```
  **Expected:** every call returns `403`, and nothing changes.
- [ ] **Signed out:** in a private window, open the site → **Expected:** the sign-in screen. `fetch(API + '/users')` without a token → `401`.

---

## 4. UI/UX and mobile — الواجهة والجوال

### 4.1 Arabic RTL (desktop: Chrome, plus Firefox or Edge)

- [ ] Text runs right-to-left and the menu is on the right; nothing is mirrored wrongly.
- [ ] Numbers, dates (Asia/Hebron time) and point signs (`+10`, `−5`) display correctly; emails and URLs read left-to-right.
- [ ] Tables sort and search; dialogs open, close with **إلغاء** (cancel) or Esc, and keep focus.

### 4.2 Mobile (a phone, or 375 × 812)

- [ ] No horizontal page scroll on any page.
- [ ] The bottom navigation bar is visible; **More** opens the remaining items.
- [ ] Dialogs fit the screen; the number keypad opens for points fields; buttons are easy to tap.
- [ ] Wide tables scroll inside their card; the page itself doesn't scroll sideways.
- [ ] Repeat on Safari iOS and Chrome Android if available.

### 4.3 Loading and error states

- [ ] Each page shows a loading state, then data or an empty state (for example **لم تُسجَّل نقاط هذا الشهر بعد**, "no points recorded this month yet"), never a blank page.
- [ ] DevTools → Network → **Offline**, then retry an action → **Expected:** an Arabic error message, the app doesn't crash, and it works again when you go back online.
- [ ] Every server-side refusal shows a clear Arabic message, not a raw code. Check these:
  - `SELF_LOCKOUT`
  - `TEAM_MANAGER_EXISTS`
  - duplicate points
  - out-of-range points

### 4.4 Console and network hygiene (every role)

- [ ] **Console:** no red errors during all the flows above.
- [ ] **Network:**
  - no CORS errors
  - no requests to `localhost`
  - no `5xx` responses
  - `POST /api/points` requests carry an `Idempotency-Key` header
- [ ] No secret appears in the frontend: search the page sources (Ctrl+Shift+F in Sources) for `sk_` or `GEMINI` → **Expected:** nothing found.

---

## 5. Sign-off

| Area | Pass / Fail | Tester | Date | Notes |
|------|:-----------:|--------|------|-------|
| 1 Organizer | | | | |
| 2 Manager | | | | |
| 3 Member | | | | |
| 4 UI/UX & Mobile | | | | |

### Bug log

| # | Role | Page / endpoint | Steps | Expected | Actual | Screenshot / time |
|---|------|-----------------|-------|----------|--------|-------------------|
| 1 | | | | | | |
