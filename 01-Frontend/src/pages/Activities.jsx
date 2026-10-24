import { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useAppData } from "../context/AppDataContext.jsx";
import { useAsync } from "../hooks/useAsync.js";
import { activitiesApi } from "../services/activities.js";
import { CAMPUS } from "../lib/constants.js";
import {
  Avatar,
  PageHeader,
  Card,
} from "../components/ui/Primitives.jsx";
import { Async } from "../components/ui/States.jsx";

const emptyForm = () => ({
  userId: "",
  label: "",
  points: "",
  description: "",
});
function RatingJumpLinks() {
  const { user } = useAuth();

  if (user.role !== "organizer") return null;

  return (
    <nav className="rating-jump-links" aria-label="انتقل إلى قسم التقييم">
      <a href="#rating-managers"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("rating-managers")?.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "auto"
              : "smooth",
            block: "start",
          });
        }}
      >
        ✦ المديرون
      </a>

      <a href="#rating-members"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("rating-members")?.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "auto"
              : "smooth",
            block: "start",
          });
        }}
      >
        ✧ الأعضاء
      </a>

      <a href="#rating-organizers"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("rating-organizers")?.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "auto"
              : "smooth",
            block: "start",
          });
        }}
      >
        ⚡ المنظّمون
      </a>
    </nav>
  );
}
function ActivityPerson({ person }) {
  return (
    <Card>
      <div className="role-person-heading">
        <Avatar name={person.name} photo={person.photo} />
        <h3>{person.name}</h3>
      </div>

      <p>
        {CAMPUS[person.campus]} · {person.teamsLabel}
      </p>

      <div className="activity-statistics">
        <div>
          <strong>{person.total}</strong>
          <span>نقاط الأنشطة</span>
        </div>

        <div>
          <strong dir="ltr">
            {person.percentage.toFixed(2)}%
          </strong>
          <span>من مجموع نقاط الجميع في الفرعين</span>
        </div>
      </div>

      <progress
        className="activity-progress"
        max={100}
        value={person.percentage}
        aria-label={`نسبة نقاط ${person.name}`}
      />

      <details className="activity-history">
        <summary>
          سجل الأنشطة ({person.entries.length})
        </summary>

        {!person.entries.length ? (
          <p>لم تُسجل أنشطة لهذا الشهر.</p>
        ) : (
          person.entries.map((entry) => (
            <article className="activity-entry" key={entry.id}>
              <div className="activity-entry-heading">
                <h4>{entry.label}</h4>
                <strong>{entry.points} نقطة</strong>
              </div>

              <p style={{ whiteSpace: "pre-wrap" }}>
                {entry.description}
              </p>

              <small>
                بواسطة {entry.actorName}
                {" · "}
                {new Date(entry.ts).toLocaleDateString("ar")}
              </small>
            </article>
          ))
        )}
      </details>
    </Card>
  );
}

function ActivitySection({
    id,
  title,
  description,
  people,
  month,
  locked,
  canCreate,
  managerSection = false,
  onSaved,
}) {
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const sorted = [...people].sort((a, b) =>
    a.name.localeCompare(b.name, "ar"),
  );

  const targets = sorted.filter((person) => person.canRate);

  const pointsInvalid =
    form.points !== "" &&
    (!Number.isInteger(Number(form.points)) ||
      Number(form.points) < 0 ||
      Number(form.points) > 99);

  const selectedAllowed = targets.some(
    (person) => person.id === form.userId,
  );

  const complete =
    selectedAllowed &&
    !!form.label.trim() &&
    !!form.description.trim() &&
    form.points !== "" &&
    !pointsInvalid;

  function changeField(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));

    setError("");
    setSuccess("");
  }

  async function submit(event) {
    event.preventDefault();

    if (!canCreate || busy || locked || !complete) return;

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      await activitiesApi.save({
        userId: form.userId,
        month,
        label: form.label.trim(),
        points: Number(form.points),
        description: form.description.trim(),
      });

      setForm((previous) => ({
        ...emptyForm(),
        userId: previous.userId,
      }));

      setSuccess("تم حفظ النشاط وإضافة النقاط.");
      onSaved();
    } catch (err) {
      setError(err?.message || "تعذر حفظ النشاط.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      id={id}
      className={`role-rating-section ${
        managerSection ? "manager-rating-section" : "member-rating-section"
      }`}
    >
      <div className="role-rating-heading">
        <span className="role-rating-symbol">
          {managerSection ? "✦" : "⚡"}
        </span>

        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>

        <span className="role-rating-count">{people.length}</span>
      </div>

      {canCreate && (
        <Card>
          <h3>
            {managerSection
              ? "إضافة نشاط لمدير"
              : "إضافة تقييم نشاط"}
          </h3>

          <form onSubmit={submit}>
            <fieldset
              className="activity-form"
              disabled={busy || locked || targets.length === 0}
            >
              <label className="f">
                {managerSection ? "المدير" : "الشخص"}

                <select
                  name="userId"
                  value={form.userId}
                  onChange={changeField}
                  required
                >
                  <option value="">اختر الشخص</option>

                  {targets.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name} — {CAMPUS[person.campus]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="f">
                اسم النشاط

                <input
                  name="label"
                  value={form.label}
                  onChange={changeField}
                  maxLength={160}
                  placeholder="مثال: تنظيم ورشة React"
                  required
                />
              </label>

              <label className="f">
                نقاط النشاط — من 0 إلى 99

                <input
                  type="number"
                  name="points"
                  min={0}
                  max={99}
                  step={1}
                  value={form.points}
                  onChange={changeField}
                  aria-invalid={pointsInvalid}
                  placeholder="0–99"
                  required
                />

                {pointsInvalid && (
                  <small className="activity-error">
                    أدخل عددًا صحيحًا من 0 إلى 99.
                  </small>
                )}
              </label>

              <label className="f">
                اشرح أكثر عن النشاط من أجل صفحة الواجهة — مطلوب

                <textarea
                  name="description"
                  value={form.description}
                  onChange={changeField}
                  maxLength={2000}
                  rows={4}
                  placeholder="وضح النشاط ومساهمة الشخص فيه..."
                  required
                />
              </label>

              <button
                type="submit"
                className="activity-submit"
                disabled={busy || locked || !complete}
              >
                {busy ? "جارٍ الحفظ..." : "حفظ النشاط"}
              </button>
            </fieldset>
          </form>

          {locked && (
            <p className="sub">هذا الشهر مقفل للعرض فقط.</p>
          )}

          {!targets.length && (
            <p className="sub">
              لا يوجد أشخاص متاحون للتقييم في هذا القسم.
            </p>
          )}

          {error && (
            <p className="activity-error" role="alert">
              {error}
            </p>
          )}

          {success && <p role="status">{success}</p>}
        </Card>
      )}

      <div className="activity-members" style={{ marginTop: 18 }}>
        {sorted.map((person) => (
          <ActivityPerson key={person.id} person={person} />
        ))}
      </div>

      {!sorted.length && (
        <p className="sub">لا توجد سجلات لأشخاص في هذا القسم.</p>
      )}
    </section>
  );
}

export default function Activities() {
  const { user } = useAuth();
  const { meta } = useAppData();
  const [month, setMonth] = useState("");

  const selectedMonth = month || meta?.curMonth || "";

  const state = useAsync(
    () => activitiesApi.overview(selectedMonth || undefined),
    [selectedMonth, user.id],
  );

  const refresh = () => state.reload({ silent: true });

  return (
    <div className="role-ratings-page">
      <PageHeader
        title="تقييم الأنشطة"
        subtitle="أنشطة شهرية ونقاط مستقلة عن تقييم الأداء"
      />
      <RatingJumpLinks />

      <label className="f activity-month">
        الشهر
        <select
          value={selectedMonth}
          onChange={(event) => setMonth(event.target.value)}
        >
          {(meta?.months || []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.id}
            </option>
          ))}
        </select>
      </label>

      <Async state={state}>
        {(data) => {
          const personal = data.rows.filter(
            (person) => person.id === user.id,
          );

          const managers = data.rows.filter(
            (person) =>
              person.role === "manager" &&
              person.id !== user.id,
          );

          const members = data.rows.filter(
            (person) =>
              person.role === "member" &&
              person.id !== user.id,
          );

          const organizers = data.rows.filter(
            (person) =>
              person.role === "organizer" &&
              person.id !== user.id,
          );

          const sectionProps = {
            month: data.month,
            locked: data.locked,
            onSaved: refresh,
          };

          return (
            <div className="activities-page">
              <Card>
                <h2>إجمالي نقاط الأنشطة: {data.everyoneTotal}</h2>
                <p>
                  النسبة = نقاط الشخص ÷ نقاط جميع الأشخاص
                  في الفرعين لهذا الشهر × 100.
                </p>
                <p>
                  {data.locked
                    ? "هذا الشهر مقفل — النتائج للعرض فقط."
                    : "تتحدث النسب مع إضافة الأنشطة خلال الشهر."}
                </p>
              </Card>

              {user.role === "organizer" && (
                <>
                  <ActivitySection
                  id="rating-managers"
                    {...sectionProps}
                    key={`managers-${data.month}`}
                    title="تقييم أنشطة المديرين"
                    description="قسم خاص بالمنظّم لتوثيق أنشطة مديري المجموعات."
                    people={managers}
                    managerSection
                    canCreate
                  />

                  <ActivitySection
                  id="rating-members"
                    {...sectionProps}
                    key={`members-${data.month}`}
                    title="تقييم أنشطة الأعضاء"
                    description="سجّل أنشطة أعضاء المجموعات في الفرعين."
                    people={members}
                    canCreate
                  />

                  {organizers.length > 0 && (
                    <ActivitySection
                      id="rating-organizers"
                      {...sectionProps}
                      key={`organizers-${data.month}`}
                      title="أنشطة المنظّمين الآخرين"
                      description="يمكنك تسجيل الأنشطة للمنظّمين الآخرين باستثناء نفسك."
                      people={organizers}
                      canCreate
                    />
                  )}
                </>
              )}

              {user.role === "manager" && (
                <ActivitySection
                  {...sectionProps}
                  key={`team-${data.month}`}
                  title="تقييم أنشطة أعضاء فريقي"
                  description="الأعضاء التابعون لمجموعتك وفرعك فقط."
                  people={members}
                  canCreate
                />
              )}

              <ActivitySection
                {...sectionProps}
                key={`personal-${data.month}`}
                title="أنشطتي ونقاطي"
                description="سجلك الشخصي للعرض فقط؛ لا يمكنك تقييم نفسك."
                people={personal}
                canCreate={false}
              />
            </div>
          );
        }}
      </Async>
    </div>
  );
}