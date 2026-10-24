import { useState } from "react";
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
        <p className="sub">لا يوجد أشخاص متاحون في هذا القسم.</p>
      ) : (
        <div className="rating-people">
          {sorted.map((person) => (
            <Card key={person.id}>
              <div className="role-person-heading">
                <Avatar name={person.name} photo={person.photo} />

                <div>
                  <h3>{person.name}</h3>
                  <span className="role-person-label">
                    {managerSection ? "مدير مجموعة" : "تقييم الأداء"}
                  </span>
                </div>
              </div>

              <p>
                {CAMPUS[person.campus]} · {person.teamsLabel}
              </p>

              <strong className="role-performance-score">
                {person.total === null
                  ? "لم يُقيّم"
                  : `${person.total} / 100`}
              </strong>

              <Button
                variant="primary"
                onClick={() => onRate(person.id)}
              >
                {managerSection ? "تقييم أداء المدير" : "فتح تقييم الأداء"}
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
        title="تقييم الأداء"
        subtitle="15 بندًا ثابتًا · مجموع 100 نقطة · آخر تقييم هو المعتمد"
        actions={
          user.role !== "member" && (
            <Button
              variant="primary"
              onClick={() => setDlg("")}
            >
              تقييم شخص
            </Button>
          )
        }
      />
      <RatingJumpLinks />

      {user.role !== "manager" && (
        <>
          <label className="f activity-month">
            شهر تقييمي
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
                  تقييمي ·{" "}
                  {data.current
                    ? `${data.current.total} / 100`
                    : "لم يُسجّل بعد"}
                </h2>

                {data.current && (
                  <>
                    <div className="scorecard-grid">
                      {SCORECARD_CATEGORIES.map((category) => (
                        <div
                          className="score-field"
                          key={category.id}
                        >
                          <span>{category.label}</span>
                          <strong>
                            {data.current.scores[category.id]} /{" "}
                            {category.max}
                          </strong>
                        </div>
                      ))}
                    </div>

                    <p>{data.current.reason}</p>

                    <details>
                      <summary>
                        سجل التقييمات ({data.history.length})
                      </summary>

                      {data.history.map((entry) => (
                        <p key={entry.id}>
                          الإصدار {entry.rev} · {entry.total}/100 ·{" "}
                          {entry.actorName} · {entry.reason}
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
                بطاقات الأشخاص أدناه تخص الشهر الحالي:{" "}
                {meta?.curMonth}
              </p>

              {user.role === "organizer" ? (
                <>
                  <PerformanceSection
                   id="rating-managers"
                    title="تقييم المديرين"
                    description="مساحة المنظّم لتقييم أداء مديري المجموعات."
                    managerSection
                    people={rows.filter(
                      (person) => person.role === "manager",
                    )}
                    onRate={setDlg}
                  />

                  <PerformanceSection
                 
  id="rating-members"
                    title="تقييم الأعضاء"
                    description="قيّم أداء أعضاء المجموعات في الفرعين."
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
                      title="تقييم المنظّمين"
                      description="يمكنك تقييم المنظّمين الآخرين باستثناء نفسك."
                      people={rows.filter(
                        (person) => person.role === "organizer",
                      )}
                      onRate={setDlg}
                    />
                  )}
                </>
              ) : (
                <PerformanceSection
                  title="تقييم أعضاء فريقي"
                  description="الأعضاء المتاحون لك حسب مجموعتك وفرعك."
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