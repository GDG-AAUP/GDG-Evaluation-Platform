import { useState } from "react";
import { tr } from "../i18n/index.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useAppData } from "../context/AppDataContext.jsx";
import { useAsync } from "../hooks/useAsync.js";
import { ratingsApi } from "../services/ratings.js";
import { activitiesApi } from "../services/activities.js";
import { SCORECARD_CATEGORIES } from "../lib/scorecard.js";
import { PageHeader, Card } from "../components/ui/Primitives.jsx";
import { Async } from "../components/ui/States.jsx";

export default function MyPoints()  {
  const { user } = useAuth();
  const { meta } = useAppData();
  const [month, setMonth] = useState("");

  const selectedMonth = month || meta?.curMonth || "";

  const state = useAsync(
    async () => {
      const [performance, activities] = await Promise.all([
        ratingsApi.detail(user.id, selectedMonth || undefined),
        activitiesApi.overview(selectedMonth || undefined),
      ]);

      return {
        performance,
        activity: activities.rows.find((row) => row.id === user.id),
        everyoneTotal: activities.everyoneTotal,
        locked: activities.locked,
      };
    },
    [user.id, selectedMonth],
  );

  return (
    <>
      <PageHeader
        title={tr("تقييمي العام")}
        subtitle={tr("تابع تقييم أدائك ونقاط أنشطتك وسجل تقدمك الشهري")}
      />

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
        {({ performance, activity, everyoneTotal, locked }) => {
          const current = performance.current;
          const entries = activity?.entries || [];
          const total = activity?.total || 0;
          const percentage = activity?.percentage || 0;

          return (
            <div className="evaluation-overview">
              <div className="evaluation-summary-grid">
                <Card>
                  <h2>{tr("تقييم الأداء")}</h2>

                  <strong className="evaluation-big-number">
                    {current ? `${current.total} / 100` : tr("لم تُقيّم بعد")}
                  </strong>

                  <p>{tr("نتيجة آخر بطاقة تقييم معتمدة لهذا الشهر.")}</p>

                  {current && (
                    <progress
                      className="activity-progress"
                      max={100}
                      value={current.total}
                      aria-label={tr("تقييم الأداء")}
                    />
                  )}
                </Card>

                <Card>
                  <h2>{tr("تقييم الأنشطة")}</h2>

                  <strong className="evaluation-big-number">
                    {percentage.toFixed(2)}%
                  </strong>

                  <p>
                    {tr("مجموع نقاطك:")} <strong>{total}</strong>
                    {" · "}
                    {tr("عدد الأنشطة:")} <strong>{entries.length}</strong>
                  </p>

                  <progress
                    className="activity-progress"
                    max={100}
                    value={percentage}
                    aria-label={tr("نسبة نقاط الأنشطة")}
                  />

                  <p>
                    {tr("نسبتك من إجمالي نقاط أنشطة الجميع: {n} نقطة.", { n: everyoneTotal })}
                  </p>

                  <small>
                    {locked
                      ? tr("نتائج الشهر مقفلة.")
                      : tr("تتغير النسبة مع إضافة أنشطة جديدة خلال الشهر.")}
                  </small>
                </Card>
              </div>

              <Card>
                <h2>{tr("تفاصيل تقييم الأداء")}</h2>

                {!current ? (
                  <p>{tr("لم يُسجل تقييم أداء لهذا الشهر.")}</p>
                ) : (
                  <>
                    <div className="scorecard-grid">
                      {SCORECARD_CATEGORIES.map((category) => (
                        <div className="score-field" key={category.id}>
                          <span>{tr(category.label)}</span>
                          <strong>
                            {current.scores[category.id]} / {category.max}
                          </strong>
                        </div>
                      ))}
                    </div>

                    <p className="evaluation-description">
                      {tr(current.reason)}
                    </p>
                  </>
                )}
              </Card>

              <Card>
                <h2>{tr("سجل تقييمات الأداء")}</h2>

                {performance.history.length === 0 ? (
                  <p>{tr("لا توجد تقييمات لهذا الشهر.")}</p>
                ) : (
                  [...performance.history]
                    .sort((a, b) => b.rev - a.rev)
                    .map((entry) => (
                      <article className="activity-entry" key={entry.id}>
                        <div className="activity-entry-heading">
                          <h3>{tr("الإصدار {n}", { n: entry.rev })}</h3>
                          <strong>{entry.total} / 100</strong>
                        </div>

                        <p className="evaluation-description">
                          {tr(entry.reason)}
                        </p>

                        <small>
                          {tr("بواسطة {name}", { name: entry.actorName })}
                          {" · "}
                          {new Date(entry.ts).toLocaleDateString("ar")}
                        </small>
                      </article>
                    ))
                )}
              </Card>

              <Card>
                <h2>{tr("سجل الأنشطة")}</h2>

                {entries.length === 0 ? (
                  <p>{tr("لم تُسجل أنشطة لهذا الشهر.")}</p>
                ) : (
                  entries.map((entry) => (
                    <article className="activity-entry" key={entry.id}>
                      <div className="activity-entry-heading">
                        <h3>{tr(entry.label)}</h3>
                        <strong>{tr("{n} نقطة", { n: entry.points })}</strong>
                      </div>

                      <p className="evaluation-description">
                        {tr(entry.description)}
                      </p>

                      <small>
                        {tr("بواسطة {name}", { name: entry.actorName })}
                        {" · "}
                        {new Date(entry.ts).toLocaleDateString("ar")}
                      </small>
                    </article>
                  ))
                )}
              </Card>
            </div>
          );
        }}
      </Async>
    </>
  );
}