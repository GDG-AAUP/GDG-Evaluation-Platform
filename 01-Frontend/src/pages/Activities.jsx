import { tr } from "../i18n/index.js";
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
    <nav className="rating-jump-links" aria-label={tr("انتقل إلى قسم التقييم")}>
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
        ✦ {tr("المديرون")}
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
        ✧ {tr("الأعضاء")}
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
        ⚡ {tr("المنظّمون")}
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
        {tr(CAMPUS[person.campus])} · {tr(person.teamsLabel)}
      </p>

      <div className="activity-statistics">
        <div>
          <strong>{person.total}</strong>
          <span>{tr("نقاط الأنشطة")}</span>
        </div>

        <div>
          <strong dir="ltr">
            {person.percentage.toFixed(2)}%
          </strong>
          <span>{tr("من مجموع نقاط الجميع في الفرعين")}</span>
        </div>
      </div>

      <progress
        className="activity-progress"
        max={100}
        value={person.percentage}
        aria-label={tr("نسبة نقاط {name}", { name: person.name })}
      />

      <details className="activity-history">
        <summary>
          {tr("سجل الأنشطة ({n})", { n: person.entries.length })}
        </summary>

        {!person.entries.length ? (
          <p>{tr("لم تُسجل أنشطة لهذا الشهر.")}</p>
        ) : (
          person.entries.map((entry) => (
            <article className="activity-entry" key={entry.id}>
              <div className="activity-entry-heading">
                <h4>{entry.label}</h4>
                <strong>{tr("{n} نقطة", { n: entry.points })}</strong>
              </div>

              <p style={{ whiteSpace: "pre-wrap" }}>
                {entry.description}
              </p>

              <small>
                {tr("بواسطة {name}", { name: entry.actorName })}
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

      setSuccess(tr("تم حفظ النشاط وإضافة النقاط."));
      onSaved();
    } catch (err) {
      setError(tr(err?.message || "تعذر حفظ النشاط."));
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
              ? tr("إضافة نشاط لمدير")
              : tr("إضافة تقييم نشاط")}
          </h3>

          <form onSubmit={submit}>
            <fieldset
              className="activity-form"
              disabled={busy || locked || targets.length === 0}
            >
              <label className="f">
                {managerSection ? tr("المدير") : tr("الشخص")}

                <select
                  name="userId"
                  value={form.userId}
                  onChange={changeField}
                  required
                >
                  <option value="">{tr("اختر الشخص")}</option>

                  {targets.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name} — {tr(CAMPUS[person.campus])}
                    </option>
                  ))}
                </select>
              </label>

              <label className="f">
                {tr("اسم النشاط")}

                <input
                  name="label"
                  value={form.label}
                  onChange={changeField}
                  maxLength={160}
                  placeholder={tr("مثال: تنظيم ورشة React")}
                  required
                />
              </label>

              <label className="f">
                {tr("نقاط النشاط — من 0 إلى 99")}

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
                    {tr("أدخل عددًا صحيحًا من 0 إلى 99.")}
                  </small>
                )}
              </label>

              <label className="f">
                {tr("اشرح أكثر عن النشاط من أجل صفحة الواجهة — مطلوب")}

                <textarea
                  name="description"
                  value={form.description}
                  onChange={changeField}
                  maxLength={2000}
                  rows={4}
                  placeholder={tr("وضح النشاط ومساهمة الشخص فيه...")}
                  required
                />
              </label>

              <button
                type="submit"
                className="activity-submit"
                disabled={busy || locked || !complete}
              >
                {busy ? tr("جارٍ الحفظ...") : tr("حفظ النشاط")}
              </button>
            </fieldset>
          </form>

          {locked && (
            <p className="sub">{tr("هذا الشهر مقفل للعرض فقط.")}</p>
          )}

          {!targets.length && (
            <p className="sub">
              {tr("لا يوجد أشخاص متاحون للتقييم في هذا القسم.")}
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
        <p className="sub">{tr("لا توجد سجلات لأشخاص في هذا القسم.")}</p>
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
        title={tr("تقييم الأنشطة")}
        subtitle={tr("أنشطة شهرية ونقاط مستقلة عن تقييم الأداء")}
      />
      <RatingJumpLinks />

      <label className="f activity-month">
        {tr("الشهر")}
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
                <h2>{tr("إجمالي نقاط الأنشطة: {n}", { n: data.everyoneTotal })}</h2>
                <p>
                  {tr("النسبة = نقاط الشخص ÷ نقاط جميع الأشخاص في الفرعين لهذا الشهر × 100.")}
                </p>
                <p>
                  {data.locked
                    ? tr("هذا الشهر مقفل — النتائج للعرض فقط.")
                    : tr("تتحدث النسب مع إضافة الأنشطة خلال الشهر.")}
                </p>
              </Card>

              {user.role === "organizer" && (
                <>
                  <ActivitySection
                  id="rating-managers"
                    {...sectionProps}
                    key={`managers-${data.month}`}
                    title={tr("تقييم أنشطة المديرين")}
                    description={tr("قسم خاص بالمنظّم لتوثيق أنشطة مديري المجموعات.")}
                    people={managers}
                    managerSection
                    canCreate
                  />

                  <ActivitySection
                  id="rating-members"
                    {...sectionProps}
                    key={`members-${data.month}`}
                    title={tr("تقييم أنشطة الأعضاء")}
                    description={tr("سجّل أنشطة أعضاء المجموعات في الفرعين.")}
                    people={members}
                    canCreate
                  />

                  {organizers.length > 0 && (
                    <ActivitySection
                      id="rating-organizers"
                      {...sectionProps}
                      key={`organizers-${data.month}`}
                      title={tr("أنشطة المنظّمين الآخرين")}
                      description={tr("يمكنك تسجيل الأنشطة للمنظّمين الآخرين باستثناء نفسك.")}
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
                  title={tr("تقييم أنشطة أعضاء فريقي")}
                  description={tr("الأعضاء التابعون لمجموعتك وفرعك فقط.")}
                  people={members}
                  canCreate
                />
              )}

              <ActivitySection
                {...sectionProps}
                key={`personal-${data.month}`}
                title={tr("أنشطتي ونقاطي")}
                description={tr("سجلك الشخصي للعرض فقط؛ لا يمكنك تقييم نفسك.")}
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