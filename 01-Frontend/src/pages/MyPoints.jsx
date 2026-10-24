import { useState } from "react";
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
        title="تقييمي العام"
        subtitle="تابع تقييم أدائك ونقاط أنشطتك وسجل تقدمك الشهري"
      />

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
        {({ performance, activity, everyoneTotal, locked }) => {
          const current = performance.current;
          const entries = activity?.entries || [];
          const total = activity?.total || 0;
          const percentage = activity?.percentage || 0;

          return (
            <div className="evaluation-overview">
              <div className="evaluation-summary-grid">
                <Card>
                  <h2>تقييم الأداء</h2>

                  <strong className="evaluation-big-number">
                    {current ? `${current.total} / 100` : "لم تُقيّم بعد"}
                  </strong>

                  <p>نتيجة آخر بطاقة تقييم معتمدة لهذا الشهر.</p>

                  {current && (
                    <progress
                      className="activity-progress"
                      max={100}
                      value={current.total}
                      aria-label="تقييم الأداء"
                    />
                  )}
                </Card>

                <Card>
                  <h2>تقييم الأنشطة</h2>

                  <strong className="evaluation-big-number">
                    {percentage.toFixed(2)}%
                  </strong>

                  <p>
                    مجموع نقاطك: <strong>{total}</strong>
                    {" · "}
                    عدد الأنشطة: <strong>{entries.length}</strong>
                  </p>

                  <progress
                    className="activity-progress"
                    max={100}
                    value={percentage}
                    aria-label="نسبة نقاط الأنشطة"
                  />

                  <p>
                    نسبتك من إجمالي نقاط أنشطة الجميع: {everyoneTotal} نقطة.
                  </p>

                  <small>
                    {locked
                      ? "نتائج الشهر مقفلة."
                      : "تتغير النسبة مع إضافة أنشطة جديدة خلال الشهر."}
                  </small>
                </Card>
              </div>

              <Card>
                <h2>تفاصيل تقييم الأداء</h2>

                {!current ? (
                  <p>لم يُسجل تقييم أداء لهذا الشهر.</p>
                ) : (
                  <>
                    <div className="scorecard-grid">
                      {SCORECARD_CATEGORIES.map((category) => (
                        <div className="score-field" key={category.id}>
                          <span>{category.label}</span>
                          <strong>
                            {current.scores[category.id]} / {category.max}
                          </strong>
                        </div>
                      ))}
                    </div>

                    <p className="evaluation-description">
                      {current.reason}
                    </p>
                  </>
                )}
              </Card>

              <Card>
                <h2>سجل تقييمات الأداء</h2>

                {performance.history.length === 0 ? (
                  <p>لا توجد تقييمات لهذا الشهر.</p>
                ) : (
                  [...performance.history]
                    .sort((a, b) => b.rev - a.rev)
                    .map((entry) => (
                      <article className="activity-entry" key={entry.id}>
                        <div className="activity-entry-heading">
                          <h3>الإصدار {entry.rev}</h3>
                          <strong>{entry.total} / 100</strong>
                        </div>

                        <p className="evaluation-description">
                          {entry.reason}
                        </p>

                        <small>
                          بواسطة {entry.actorName}
                          {" · "}
                          {new Date(entry.ts).toLocaleDateString("ar")}
                        </small>
                      </article>
                    ))
                )}
              </Card>

              <Card>
                <h2>سجل الأنشطة</h2>

                {entries.length === 0 ? (
                  <p>لم تُسجل أنشطة لهذا الشهر.</p>
                ) : (
                  entries.map((entry) => (
                    <article className="activity-entry" key={entry.id}>
                      <div className="activity-entry-heading">
                        <h3>{entry.label}</h3>
                        <strong>{entry.points} نقطة</strong>
                      </div>

                      <p className="evaluation-description">
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
              </Card>
            </div>
          );
        }}
      </Async>
    </>
  );
}