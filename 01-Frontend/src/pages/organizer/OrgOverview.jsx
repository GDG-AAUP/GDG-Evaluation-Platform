import { useState } from "react";
import { useAppData } from "../../context/AppDataContext.jsx";
import { useBranch } from "../../context/BranchContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { useAsync } from "../../hooks/useAsync.js";
import { CAMPUS } from "../../lib/constants.js";
import { tr } from "../../i18n/index.js";
import {
  fmtDateTime,
  monthLabel,
  nextMonth,
} from "../../lib/format.js";
import {
  archiveApi,
  dashboardApi,
} from "../../services/index.js";
import { ratingsApi } from "../../services/ratings.js";
import AddPointsDialog from "../../components/domain/AddPointsDialog.jsx";
import UserDialog from "../../components/domain/UserDialog.jsx";
import { ConfirmDialog } from "../../components/ui/Dialog.jsx";
import {
  Button,
  Card,
  Grid,
  MetricCard,
  PageHeader,
} from "../../components/ui/Primitives.jsx";
import {
  Async,
  EmptyState,
} from "../../components/ui/States.jsx";
import { Link, navigate } from "../../router/router.jsx";

const COLORS = {
  blue: "#4285f4",
  purple: "#8b5cf6",
  teal: "#0d9488",
  green: "#22a06b",
  amber: "#f59e0b",
  rose: "#ed6484",
  gray: "#94a3b8",
};

const MEMBER_COLORS = [
  COLORS.teal,
  COLORS.blue,
  COLORS.purple,
  COLORS.amber,
  COLORS.rose,
  COLORS.gray,
];

function PieChart({ items, unit, emptyText }) {
  const [active, setActive] = useState(null);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const positive = items.filter((item) => item.value > 0);

  if (total <= 0) {
    return (
      <div className="gdg-pie-empty">
        <div className="gdg-pie-empty-circle" />
        <p>{emptyText || tr("لا توجد بيانات لعرضها.")}</p>
      </div>
    );
  }

  let angle = -90;

  const slices = positive.map((item) => {
    const sweep = (item.value / total) * 360;
    const start = angle;
    const middle = start + sweep / 2;
    angle += sweep;

    const point = (degrees, radius = 92) => {
      const radians = (degrees * Math.PI) / 180;
      return [
        120 + radius * Math.cos(radians),
        120 + radius * Math.sin(radians),
      ];
    };

    const [x1, y1] = point(start);
    const [x2, y2] = point(angle);
    const [labelX, labelY] = point(middle, 61);
    const radians = (middle * Math.PI) / 180;

    return {
      ...item,
      percentage: (item.value / total) * 100,
      path: [
        "M 120 120",
        `L ${x1} ${y1}`,
        `A 92 92 0 ${sweep > 180 ? 1 : 0} 1 ${x2} ${y2}`,
        "Z",
      ].join(" "),
      labelX,
      labelY,
      dx: Math.cos(radians) * 5,
      dy: Math.sin(radians) * 5,
    };
  });

  return (
    <div className="gdg-pie-layout">
      <svg
        className="gdg-pie-svg"
        viewBox="0 0 240 240"
        role="img"
        aria-label={items
          .map(
            (item) =>
              `${item.label}: ${((item.value / total) * 100).toFixed(2)}%`,
          )
          .join("، ")}
        onMouseLeave={() => setActive(null)}
      >
        {slices.map((slice) => (
          <g
            key={slice.id}
            className="gdg-pie-slice"
            style={{
              transform:
                active === slice.id
                  ? `translate(${slice.dx}px, ${slice.dy}px)`
                  : "translate(0, 0)",
              opacity:
                active && active !== slice.id ? 0.5 : 1,
            }}
            onMouseEnter={() => setActive(slice.id)}
          >
            <title>
              {slice.label}: {slice.percentage.toFixed(2)}%
              {" — "}
              {Number(slice.value.toFixed(2))} {unit}
            </title>

            {slices.length === 1 ? (
              <circle
                cx="120"
                cy="120"
                r="92"
                fill={slice.color}
                stroke="var(--card)"
                strokeWidth="3"
              />
            ) : (
              <path
                d={slice.path}
                fill={slice.color}
                stroke="var(--card)"
                strokeWidth="3"
                strokeLinejoin="round"
              />
            )}

            {slice.percentage >= 7 && (
              <text
                x={slices.length === 1 ? 120 : slice.labelX}
                y={slices.length === 1 ? 120 : slice.labelY}
                textAnchor="middle"
                dominantBaseline="middle"
                className="gdg-pie-label"
              >
                {slice.percentage.toFixed(2)}%
              </text>
            )}
          </g>
        ))}
      </svg>

      <div className="gdg-pie-legend">
        {items.map((item) => {
          const percentage = (item.value / total) * 100;

          return (
            <div
              key={item.id}
              className="gdg-pie-legend-row"
              onMouseEnter={() => setActive(item.id)}
              onMouseLeave={() => setActive(null)}
            >
              <span
                className="gdg-pie-dot"
                style={{ background: item.color }}
              />

              <div className="gdg-pie-legend-name">
                <strong>{item.label}</strong>
                <small>
                  {Number(item.value.toFixed(2))} {unit}
                </small>
              </div>

              <b dir="ltr">{percentage.toFixed(2)}%</b>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PerformanceBars({ teams }) {
  return (
    <div className="gdg-performance-bars">
      {teams.map((team) => {
        const value = team.performanceAverage;
        const hasRating = value !== null;

        return (
          <div key={team.id}>
            <div className="gdg-bar-heading">
              <span>
                {tr(CAMPUS[team.campus])} · {team.name}
              </span>
              <b dir="ltr">
                {hasRating ? `${value.toFixed(2)} / 100` : "—"}
              </b>
            </div>

            <div
              className="gdg-bar-track"
              role="img"
              aria-label={
                hasRating
                  ? tr("{name}: {value} من 100", { name: team.name, value: value.toFixed(2) })
                  : tr("{name}: لم يسجل تقييم أداء", { name: team.name })
              }
            >
              <span
                style={{
                  width: `${hasRating ? value : 0}%`,
                  background:
                    team.campus === "jenin"
                      ? COLORS.blue
                      : COLORS.purple,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ActivityBars({ people, total }) {
  const rows = [...people]
    .filter((person) => person.activityPoints > 0)
    .sort((a, b) => b.activityPoints - a.activityPoints)
    .slice(0, 5);

  if (!rows.length) {
    return <p className="sub">{tr("لا توجد نقاط أنشطة بعد.")}</p>;
  }

  return (
    <div className="gdg-performance-bars">
      {rows.map((person, index) => {
        const percentage = total
          ? (person.activityPoints / total) * 100
          : 0;

        return (
          <div key={person.id}>
            <div className="gdg-bar-heading">
              <span>{person.name}</span>
              <b dir="ltr">{percentage.toFixed(2)}%</b>
            </div>

            <div
              className="gdg-bar-track"
              role="img"
              aria-label={`${person.name}: ${percentage.toFixed(2)}%`}
            >
              <span
                style={{
                  width: `${percentage}%`,
                  background: MEMBER_COLORS[index],
                }}
              />
            </div>

            <small className="sub">
              {tr("{points} نقطة · {campus}", { points: person.activityPoints, campus: tr(CAMPUS[person.campus]) })}
            </small>
          </div>
        );
      })}
    </div>
  );
}

export default function OrgOverview() {
  const toast = useToast();
  const { reload: reloadMeta } = useAppData();
  const { branch, setBranch } = useBranch();

  const [combined, setCombined] = useState(false);
  const [dlg, setDlg] = useState(null);

  const campus = combined ? "all" : branch;

  const state = useAsync(async () => {
    const [summary, original] = await Promise.all([
      ratingsApi.organizerDashboard(campus),
      dashboardApi.getOrgOverview(),
    ]);

    return {
      ...summary,
      recent: original.recent,
    };
  }, [campus]);

  const close = () => setDlg(null);
  const done = () => state.reload({ silent: true });

  function chooseScope(value) {
    setCombined(value === "all");

    if (value !== "all") {
      setBranch(value);
    }
  }

  async function closeMonth() {
    await archiveApi.closeMonth();
    await reloadMeta();
    toast.success(tr("تم إغلاق الشهر وحفظ اللقطة"));
    done();
  }

  return (
    <div className="org-rating-overview">
      <PageHeader
        title={tr("نظرة عامة")}
        subtitle={
          campus === "all"
            ? tr("إحصائيات الفرعين معًا")
            : tr("إحصائيات فرع {campus}", { campus: tr(CAMPUS[campus]) })
        }
        actions={
          <div className="overview-actions">
            <Button
              icon="user-plus"
              onClick={() => setDlg("member")}
            >
              {tr("إضافة عضو")}
            </Button>

            <Button
              icon="star"
              onClick={() => setDlg("points")}
            >
              {tr("تقييم الأداء")}
            </Button>

            <Button onClick={() => navigate("/activities")}>
              {tr("تقييم الأنشطة")}
            </Button>

            <Button
              variant="primary"
              icon="archive"
              onClick={() => setDlg("close")}
            >
              {tr("إغلاق الشهر")}
            </Button>
          </div>
        }
      />

      <div className="overview-scope" aria-label={tr("نطاق الإحصائيات")}>
        {[
          ["jenin", tr("جنين")],
          ["ramallah", tr("رام الله")],
          ["all", tr("الفريقين معًا")],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={campus === value}
            onClick={() => chooseScope(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <Async state={state}>
        {(data) => {
          const scopeLabel =
            data.campus === "all"
              ? tr("الفرعين معًا")
              : tr("فرع {campus}", { campus: tr(CAMPUS[data.campus]) });

          const people = data.people;

          const performanceDistribution = [
            {
              id: "excellent",
              label: tr("أداء 90–100"),
              color: COLORS.blue,
              value: people.filter(
                (person) =>
                  person.performance !== null &&
                  person.performance >= 90,
              ).length,
            },
            {
              id: "good",
              label: tr("أداء 70–89"),
              color: COLORS.teal,
              value: people.filter(
                (person) =>
                  person.performance !== null &&
                  person.performance >= 70 &&
                  person.performance < 90,
              ).length,
            },
            {
              id: "developing",
              label: tr("أداء 50–69"),
              color: COLORS.amber,
              value: people.filter(
                (person) =>
                  person.performance !== null &&
                  person.performance >= 50 &&
                  person.performance < 70,
              ).length,
            },
            {
              id: "below50",
              label: tr("أداء أقل من 50"),
              color: COLORS.rose,
              value: people.filter(
                (person) =>
                  person.performance !== null &&
                  person.performance < 50,
              ).length,
            },
            {
              id: "unrated",
              label: tr("لم يُقيّم بعد"),
              color: COLORS.gray,
              value: people.filter(
                (person) => person.performance === null,
              ).length,
            },
          ];

          const activePeople = [...people]
            .filter((person) => person.activityPoints > 0)
            .sort(
              (a, b) =>
                b.activityPoints - a.activityPoints ||
                a.name.localeCompare(b.name, "ar"),
            );

          const contributionItems = activePeople
            .slice(0, 5)
            .map((person, index) => ({
              id: person.id,
              label: person.name,
              value: person.activityPoints,
              color: MEMBER_COLORS[index],
            }));

          const remainingPoints = activePeople
            .slice(5)
            .reduce(
              (sum, person) => sum + person.activityPoints,
              0,
            );

          if (remainingPoints > 0) {
            contributionItems.push({
              id: "others",
              label: tr("بقية الأعضاء"),
              value: remainingPoints,
              color: COLORS.gray,
            });
          }

          const branchActivities = [
            {
              id: "jenin",
              label: tr("جنين"),
              color: COLORS.blue,
              value: people
                .filter((person) => person.campus === "jenin")
                .reduce(
                  (sum, person) => sum + person.activityPoints,
                  0,
                ),
            },
            {
              id: "ramallah",
              label: tr("رام الله"),
              color: COLORS.teal,
              value: people
                .filter((person) => person.campus === "ramallah")
                .reduce(
                  (sum, person) => sum + person.activityPoints,
                  0,
                ),
            },
          ];

          return (
            <div className="overview-content" key={data.campus}>
              <p className="overview-period">
                {scopeLabel} · {monthLabel(data.month)}
              </p>

              <Grid>
                <MetricCard
                  icon="users"
                  value={data.members.total}
                  label={tr("الأعضاء الفعّالون")}
                />

                <MetricCard
                  icon="manager"
                  value={data.managers}
                  label={tr("المديرون الفعّالون")}
                  tone="y"
                />
              </Grid>

              <section className="overview-rating-section performance-section">
                <div className="overview-section-title">
                  <span className="overview-section-icon">✦</span>

                  <div>
                    <h2>{tr("تقييم الأداء")}</h2>
                    <p>{tr("بطاقة مستقلة من 100 لكل عضو")}</p>
                  </div>
                </div>

                <Grid>
                  <MetricCard
                    icon="star"
                    value={`${data.performance.average.toFixed(2)} / 100`}
                    label={tr("متوسط بطاقات الأداء المسجلة")}
                  />

                  <MetricCard
                    icon="users"
                    value={`${data.performance.ratedCount} / ${data.members.total}`}
                    label={tr("الأعضاء الذين تم تقييم أدائهم")}
                  />
                </Grid>

                <div className="gdg-chart-grid">
                  <Card>
                    <h3>{tr("توزيع مستويات الأداء")}</h3>
                    <p className="sub">
                      {tr("كل شريحة توضح نسبة الأعضاء في نطاق الأداء المكتوب بجانب لونها.")}
                    </p>

                    <PieChart
                      items={performanceDistribution}
                      unit={tr("عضو")}
                      emptyText={tr("أضف أعضاء لعرض توزيع الأداء.")}
                    />

                    <div className="gdg-chart-formula">
                      {tr("نسبة الشريحة = عدد أعضائها ÷ عدد أعضاء {scope} × 100. الأعضاء غير المقيّمين يظهرون بلون مستقل.", { scope: scopeLabel })}
                    </div>
                  </Card>

                  <Card>
                    <h3>{tr("متوسط الأداء لكل مجموعة")}</h3>
                    <p className="sub">
                      {tr("مجموع درجات الأداء المسجلة ÷ عدد الأعضاء المقيّمين في المجموعة.")}
                    </p>

                    <PerformanceBars teams={data.perTeam} />

                    <div className="gdg-chart-formula">
                      {tr("طول الشريط يمثل المتوسط من 100. الرمز — يعني عدم وجود بطاقات أداء مسجلة.")}
                    </div>
                  </Card>
                </div>
              </section>

              <section className="overview-rating-section activities-section">
                <div className="overview-section-title">
                  <span className="overview-section-icon">⚡</span>

                  <div>
                    <h2>{tr("تقييم الأنشطة")}</h2>
                    <p>{tr("نقاط الأنشطة فقط، مستقلة عن الأداء")}</p>
                  </div>
                </div>

                <Grid>
                  <MetricCard
                    icon="star"
                    value={data.activities.points}
                    label={tr("نقاط أنشطة الأعضاء المحددين")}
                    tone="g"
                  />

                  <MetricCard
                    icon="chart"
                    value={data.activities.count}
                    label={tr("الأنشطة المسجلة للأعضاء")}
                    tone="g"
                  />

                  <MetricCard
                    icon="users"
                    value={data.activities.participatingMembers}
                    label={tr("أعضاء لديهم أنشطة مسجلة")}
                    tone="g"
                  />
                </Grid>

                <div className="gdg-chart-grid">
                  <Card>
                    <h3>{tr("حصة الأعضاء من نقاط الأنشطة")}</h3>
                    <p className="sub">
                      {tr("أعلى خمسة أعضاء بالنقاط، وبقية الأعضاء في شريحة واحدة.")}
                    </p>

                    <PieChart
                      items={contributionItems}
                      unit={tr("نقطة")}
                      emptyText={tr("سجّل نقاط أنشطة لعرض مساهمات الأعضاء.")}
                    />

                    <div className="gdg-chart-formula">
                      {tr("حصة العضو هنا = نقاط أنشطته ÷ مجموع نقاط أنشطة أعضاء {scope} × 100.", { scope: scopeLabel })}
                    </div>
                  </Card>

                  <Card>
                    <h3>{tr("أعلى خمس مساهمات بالأنشطة")}</h3>
                    <p className="sub">
                      {tr("الحصة من نقاط الأنشطة داخل النطاق المحدد.")}
                    </p>

                    <ActivityBars
                      people={people}
                      total={data.activities.points}
                    />

                    <div className="gdg-chart-formula">
                      {tr("هذه النسب خاصة بتحليل النطاق المحدد. النسبة الرسمية في الترتيب العام تعتمد على مجموع نقاط الجميع في الفرعين.")}
                    </div>
                  </Card>
                </div>

                {data.campus === "all" && (
                  <Card style={{ marginTop: 18 }}>
                    <h3>{tr("توزيع نقاط الأنشطة بين الفرعين")}</h3>
                    <p className="sub">
                      {tr("مقارنة حصة أعضاء جنين بحصة أعضاء رام الله.")}
                    </p>

                    <PieChart
                      items={branchActivities}
                      unit={tr("نقطة")}
                      emptyText={tr("لا توجد نقاط أنشطة للأعضاء بعد.")}
                    />

                    <div className="gdg-chart-formula">
                      {tr("حصة الفرع = نقاط أنشطة أعضائه ÷ مجموع نقاط أنشطة أعضاء الفرعين × 100.")}
                    </div>
                  </Card>
                )}
              </section>

              <Card>
                <h3>{tr("أعضاء {scope}", { scope: scopeLabel })}</h3>
                <p className="sub">
                  {tr("نسبة الأنشطة الرسمية أدناه تستخدم مجموع نقاط الجميع في الفرعين، مثل صفحة الترتيب.")}
                </p>

                {!people.length ? (
                  <EmptyState
                    icon="users"
                    title={tr("لا يوجد أعضاء فعّالون")}
                    text={tr("سيظهر الأعضاء بعد إضافتهم.")}
                  />
                ) : (
                  <div className="overview-table-wrap">
                    <table className="overview-members-table">
                      <thead>
                        <tr>
                          <th>{tr("الاسم")}</th>
                          <th>{tr("الفرع")}</th>
                          <th>{tr("الأداء / 100")}</th>
                          <th>{tr("نقاط الأنشطة")}</th>
                          <th>{tr("نسبة الأنشطة الرسمية")}</th>
                        </tr>
                      </thead>

                      <tbody>
                        {people.map((person) => (
                          <tr key={person.id}>
                            <td>{person.name}</td>
                            <td>{tr(CAMPUS[person.campus])}</td>
                            <td>
                              {person.performance === null
                                ? tr("لم يُقيّم")
                                : person.performance.toFixed(2)}
                            </td>
                            <td>{person.activityPoints}</td>
                            <td>
                              <span dir="ltr">
                                {person.activityPercentage.toFixed(2)}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card>
                <h3>{tr("آخر العمليات الإدارية — المنصة كاملة")}</h3>

                {data.recent.length === 0 ? (
                  <EmptyState
                    icon="history"
                    title={tr("لا توجد عمليات بعد")}
                    text={tr("ستظهر العمليات الإدارية هنا.")}
                  />
                ) : (
                  data.recent.map((entry) => (
                    <div className="le" key={entry.id}>
                      <div style={{ flex: 1 }}>
                        <b>{tr(entry.action)}</b> · {tr(entry.entity)}

                        <div className="sub">
                          {entry.actorName} · {fmtDateTime(entry.ts)}
                        </div>
                      </div>
                    </div>
                  ))
                )}

                <Link to="/organizer/audit">
                  {tr("عرض سجل التدقيق كاملًا")}
                </Link>
              </Card>

              {dlg === "close" && (
                <ConfirmDialog
                  title={tr("إغلاق شهر {month}", { month: monthLabel(data.month) })}
                  danger
                  confirmLabel={tr("إغلاق الشهر")}
                  onClose={close}
                  onConfirm={closeMonth}
                  message={
                    <>
                      {tr("سيُغلق الشهر للفرعين معًا وتُحفظ لقطة ترتيب الأنشطة دون حذف السجلات.")}{" "}
                      {tr("سيبدأ شهر")}{" "}
                      <b>{monthLabel(nextMonth(data.month))}</b>{" "}
                      {tr("بسجلات شهرية جديدة.")}
                    </>
                  }
                />
              )}
            </div>
          );
        }}
      </Async>

      {dlg === "member" && (
        <UserDialog
          kind="member"
          onDone={done}
          onClose={close}
        />
      )}

      {dlg === "points" && (
        <AddPointsDialog onDone={done} onClose={close} />
      )}
    </div>
  );
}