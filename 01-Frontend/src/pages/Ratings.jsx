import { useState } from "react";
import { tr } from "../i18n/index.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useAppData } from "../context/AppDataContext.jsx";
import { useAsync } from "../hooks/useAsync.js";
import { ratingsApi } from "../services/ratings.js";
import { SCORECARD_CATEGORIES } from "../lib/scorecard.js";
import { CAMPUS } from "../lib/constants.js";
import {
  Avatar,
  PageHeader,
  Button,
  Card,
} from "../components/ui/Primitives.jsx";
import AddPointsDialog from "../components/domain/AddPointsDialog.jsx";
import { Async } from "../components/ui/States.jsx";
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
        {tr("✦ المديرون")}
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
        {tr("✧ الأعضاء")}
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
        {tr("⚡ المنظّمون")}
      </a>
    </nav>
  );
}
function PerformanceSection({
  id,
  title,
  description,
  people,
  managerSection = false,
  onRate,
}) {
  const sorted = [...people].sort((a, b) =>
    a.name.localeCompare(b.name, "ar"),
  );

  return (
    <section
      id={id}
      className={`role-rating-section ${
        managerSection ? "manager-rating-section" : "member-rating-section"
      }`}
    >
      <div className="role-rating-heading">
        <span className="role-rating-symbol">
          {managerSection ? "✦" : "✧"}
        </span>

        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>

        <span className="role-rating-count">{people.length}</span>
      </div>

      {!sorted.length ? (
        <p className="sub">{tr("لا يوجد أشخاص متاحون في هذا القسم.")}</p>
      ) : (
        <div className="rating-people">
          {sorted.map((person) => (
            <Card key={person.id}>
              <div className="role-person-heading">
                <Avatar name={person.name} photo={person.photo} />

                <div>
                  <h3>{person.name}</h3>
                  <span className="role-person-label">
                    {managerSection ? tr("مدير مجموعة") : tr("تقييم الأداء")}
                  </span>
                </div>
              </div>

              <p>
                {tr(CAMPUS[person.campus])} · {tr(person.teamsLabel)}
              </p>

              <strong className="role-performance-score">
                {person.total === null
                  ? tr("لم يُقيّم")
                  : `${person.total} / 100`}
              </strong>

              <Button
                variant="primary"
                onClick={() => onRate(person.id)}
              >
                {managerSection ? tr("تقييم أداء المدير") : tr("فتح تقييم الأداء")}
              </Button>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

export default function Ratings() {
  const { user } = useAuth();
  const { meta } = useAppData();

  const [dlg, setDlg] = useState(null);
  const [month, setMonth] = useState("");

  const own = useAsync(
    () => ratingsApi.detail(user.id, month || undefined),
    [user.id, month],
  );

  const targets = useAsync(
    () =>
      user.role === "member"
        ? Promise.resolve([])
        : ratingsApi.targets(),
    [user.role],
  );

  function refreshRatings() {
    own.reload({ silent: true });
    targets.reload({ silent: true });
  }

  return (
    <div className="role-ratings-page">
      <PageHeader
        title={tr("تقييم الأداء")}
        subtitle={tr("15 بندًا ثابتًا · مجموع 100 نقطة · آخر تقييم هو المعتمد")}
        actions={
          user.role !== "member" && (
            <Button
              variant="primary"
              onClick={() => setDlg("")}
            >
              {tr("تقييم شخص")}
            </Button>
          )
        }
      />
      <RatingJumpLinks />

      {user.role !== "manager" && (
        <>
          <label className="f activity-month">
            {tr("شهر تقييمي")}
            <select
              value={month || meta?.curMonth || ""}
              onChange={(event) => setMonth(event.target.value)}
            >
              {(meta?.months || []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id}
                </option>
              ))}
            </select>
          </label>

          <Async state={own}>
            {(data) => (
              <Card>
                <h2>
                  {tr("تقييمي ·")}{" "}
                  {data.current
                    ? `${data.current.total} / 100`
                    : tr("لم يُسجّل بعد")}
                </h2>

                {data.current && (
                  <>
                    <div className="scorecard-grid">
                      {SCORECARD_CATEGORIES.map((category) => (
                        <div
                          className="score-field"
                          key={category.id}
                        >
                          <span>{tr(category.label)}</span>
                          <strong>
                            {data.current.scores[category.id]} /{" "}
                            {category.max}
                          </strong>
                        </div>
                      ))}
                    </div>

                    <p>{tr(data.current.reason)}</p>

                    <details>
                      <summary>
                        {tr("سجل التقييمات ({n})", { n: data.history.length })}
                      </summary>

                      {data.history.map((entry) => (
                        <p key={entry.id}>
                          {tr("الإصدار {n}", { n: entry.rev })} · {entry.total}/100 ·{" "}
                          {entry.actorName} · {tr(entry.reason)}
                        </p>
                      ))}
                    </details>
                  </>
                )}
              </Card>
            )}
          </Async>
        </>
      )}

      {user.role !== "member" && (
        <Async state={targets}>
          {(rows) => (
            <>
              <p className="sub">
                {tr("بطاقات الأشخاص أدناه تخص الشهر الحالي:")}{" "}
                {meta?.curMonth}
              </p>

              {user.role === "organizer" ? (
                <>
                  <PerformanceSection
                   id="rating-managers"
                    title={tr("تقييم المديرين")}
                    description={tr("مساحة المنظّم لتقييم أداء مديري المجموعات.")}
                    managerSection
                    people={rows.filter(
                      (person) => person.role === "manager",
                    )}
                    onRate={setDlg}
                  />

                  <PerformanceSection
                 
  id="rating-members"
                    title={tr("تقييم الأعضاء")}
                    description={tr("قيّم أداء أعضاء المجموعات في الفرعين.")}
                    people={rows.filter(
                      (person) => person.role === "member",
                    )}
                    onRate={setDlg}
                  />

                  {rows.some(
                    (person) => person.role === "organizer",
                  ) && (
                    <PerformanceSection
                    
  id="rating-organizers"
                      title={tr("تقييم المنظّمين")}
                      description={tr("يمكنك تقييم المنظّمين الآخرين باستثناء نفسك.")}
                      people={rows.filter(
                        (person) => person.role === "organizer",
                      )}
                      onRate={setDlg}
                    />
                  )}
                </>
              ) : (
                <PerformanceSection
                  title={tr("تقييم أعضاء فريقي")}
                  description={tr("الأعضاء المتاحون لك حسب مجموعتك وفرعك.")}
                  people={rows}
                  onRate={setDlg}
                />
              )}
            </>
          )}
        </Async>
      )}

      {dlg !== null && (
        <AddPointsDialog
          preUserId={dlg}
          onDone={refreshRatings}
          onClose={() => setDlg(null)}
        />
      )}
    </div>
  );
}