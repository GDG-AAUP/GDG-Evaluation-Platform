import { useState } from "react";
import { tr } from "../../i18n/index.js";
import { usePolicies } from "../../context/AppDataContext.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { useAsync } from "../../hooks/useAsync.js";
import { monthLabel } from "../../lib/format.js";
import { dashboardApi } from "../../services/index.js";
import { activitiesApi } from "../../services/activities.js";
import { navigate } from "../../router/router.jsx";
import AddPointsDialog from "../../components/domain/AddPointsDialog.jsx";
import UserDialog from "../../components/domain/UserDialog.jsx";
import {
  Badge,
  CampusBadge,
  UserStatusBadge,
} from "../../components/ui/Badges.jsx";
import DataTable from "../../components/ui/DataTable.jsx";
import {
  Avatar,
  Button,
  Card,
  Grid,
  MetricCard,
  PageHeader,
} from "../../components/ui/Primitives.jsx";
import { Async, EmptyState } from "../../components/ui/States.jsx";

export default function ManagerDashboard({ params }) {
  const { user } = useAuth();
  const { managerCanEditOrMoveMembers } = usePolicies();

  const teamId = params?.id || user.teams[0];

  const [dlg, setDlg] = useState(null);

 const state = useAsync(async () => {
  const team = await dashboardApi.getTeamOverview(teamId);
  const activities = await activitiesApi.overview(team.month);

  const activityById = new Map(
    activities.rows.map((row) => [row.id, row]),
  );

  const members = team.members.map((member) => {
    const activity = activityById.get(member.id);

    return {
      ...member,
      activityTotal: activity?.total || 0,
      activityPercentage: activity?.percentage || 0,
      activityCount: activity?.entries.length || 0,
    };
  });

  const groupMembers = members.filter(
    (member) =>
      member.role === "member" &&
      member.status === "active" &&
      member.id !== user.id,
  );

  const performanceTop = [...groupMembers]
    .filter((member) => member.total != null)
    .sort(
      (a, b) =>
        b.total - a.total ||
        a.name.localeCompare(b.name, "ar"),
    )
    .map((member, index, sorted) => ({
      userId: member.id,
      name: member.name,
      total: member.total,
      rank:
        sorted.findIndex(
          (item) => item.total === member.total,
        ) + 1,
    }));

  const activityTotal = groupMembers.reduce(
    (sum, member) => sum + member.activityTotal,
    0,
  );

  const activityTop = [...groupMembers]
    .filter((member) => member.activityCount > 0)
    .sort(
      (a, b) =>
        b.activityPercentage - a.activityPercentage ||
        a.name.localeCompare(b.name, "ar"),
    );

  return {
    ...team,
    members,
    top: performanceTop,
    activityTotal,
    activityTop,
  };
}, [teamId, user.id]);
  const close = () => setDlg(null);
  const done = () => state.reload({ silent: true });

  const columns = [
    {
      title: tr("الاسم"),
      sort: (row) => row.name,
      render: (row) => (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Avatar name={row.name} />

          <div>
            {row.name}
            {row.isMe && (
              <>
                {" "}
                <Badge tone="y">{tr("أنت")}</Badge>
              </>
            )}

            <div
              className="sub"
              dir="ltr"
              style={{ textAlign: "start" }}
            >
              {row.email}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: tr("تقييم الأداء"),
      sort: (row) => row.total ?? -1,
      render: (row) =>
        row.total == null ? tr("لم يُقيّم") : <b>{row.total} / 100</b>,
    },
    {
      title: tr("نقاط الأنشطة"),
      sort: (row) => row.activityTotal,
      render: (row) => <b>{row.activityTotal}</b>,
    },
    {
      title: tr("نسبة الأنشطة"),
      sort: (row) => row.activityPercentage,
      render: (row) => (
        <b>{row.activityPercentage.toFixed(2)}%</b>
      ),
    },
    {
      title: tr("عدد الأنشطة"),
      sort: (row) => row.activityCount,
      render: (row) => row.activityCount,
    },
    {
      title: tr("الحالة"),
      render: (row) => <UserStatusBadge status={row.status} />,
    },
    {
      title: tr("إجراءات"),
      render: (row) => {
        const canEvaluate =
          row.id !== user.id &&
          row.role === "member" &&
          row.status === "active";

        if (!canEvaluate) return <span className="sub">—</span>;

        return (
          <div
            className="ia"
            style={{ gap: 6, flexWrap: "wrap" }}
          >
            <Button
              small
              variant="primary"
             onClick={() => navigate("/ratings")}
            >
              {tr("تقييم الأداء")}
            </Button>

            <Button small onClick={() => navigate("/activities")}>
              {tr("تقييم الأنشطة")}
            </Button>

            {managerCanEditOrMoveMembers && (
              <Button
                small
                onClick={() =>
                  setDlg({
                    type: "edit",
                    userId: row.id,
                    row,
                  })
                }
              >
                {tr("تعديل")}
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <Async state={state}>
        {(data) => (
          <>
            <PageHeader
              title={tr("فريق {name}", { name: tr(data.team.name) })}
              subtitle={
                <>
                  <CampusBadge campus={data.team.campus} />
                  {" · "}
                  {monthLabel(data.month)}
                </>
              }
              actions={
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <Button
                    variant="primary"
                    onClick={() => navigate("/ratings")}
                  >
                    {tr("تقييم الأداء")}
                  </Button>

                  <Button onClick={() => navigate("/activities")}>
                    {tr("تقييم الأنشطة")}
                  </Button>
                </div>
              }
            />

            <Grid style={{ marginBottom: 14 }}>
              <MetricCard
                icon="users"
                value={data.metrics.activeMembers}
                label={tr("أعضاء الفريق")}
              />

              <MetricCard
                icon="star"
              value={Number(data.metrics.points ?? 0).toFixed(2)}
label={tr("مجموع تقييمات الأداء")}
              />

              <MetricCard
                icon="chart"
                value={data.activityTotal}
                label={tr("مجموع نقاط أنشطة الأعضاء")}
                tone="g"
              />
            </Grid>

            <Grid two>
              <Card>
                <h3>{tr("ترتيب الأداء")}</h3>

                {data.top.length === 0 ? (
                  <EmptyState
                    icon="trophy"
                    title={tr("لا توجد تقييمات بعد")}
                    text={tr("سجّل تقييم أداء لأعضاء فريقك.")}
                  />
                ) : (
                  data.top.map((row) => (
                    <div className="lr" key={row.userId}>
                      <span className="rk">{row.rank}</span>
                      <Avatar name={row.name} />
                      <div className="nm">{row.name}</div>
                      <span className="pt">{row.total} / 100</span>
                    </div>
                  ))
                )}
              </Card>

              <Card>
                <h3>{tr("ترتيب الأنشطة")}</h3>

                {data.activityTop.length === 0 ? (
                  <EmptyState
                    icon="star"
                    title={tr("لا توجد أنشطة بعد")}
                    text={tr("ستظهر النتائج بعد تسجيل أنشطة لأعضاء الفريق.")}
                  />
                ) : (
                  data.activityTop.map((row, index) => (
                    <div className="lr" key={row.id}>
                      <span className="rk">
                        {index === 0 ||
                        row.activityTotal !==
                          data.activityTop[index - 1].activityTotal
                          ? data.activityTop.findIndex(
                              (item) =>
                                item.activityTotal === row.activityTotal,
                            ) + 1
                          : data.activityTop.findIndex(
                              (item) =>
                                item.activityTotal === row.activityTotal,
                            ) + 1}
                      </span>

                      <Avatar name={row.name} />

                      <div className="nm">
                        {row.name}
                        <div className="sub">
                          {tr("{points} نقطة · {count} نشاط", { points: row.activityTotal, count: row.activityCount })}
                        </div>
                      </div>

                      <span className="pt">
                        {row.activityPercentage.toFixed(2)}%
                      </span>
                    </div>
                  ))
                )}
              </Card>
            </Grid>

            <Card style={{ marginTop: 14 }}>
              <h3>{tr("إرشادات سريعة")}</h3>
              <p
                style={{
                  margin: 0,
                  color: "var(--tx2)",
                  fontSize: 14,
                }}
              >
                {tr("تقييم الأداء من 100، ونقاط الأنشطة تتراكم خلال الشهر. نسبة الأنشطة تُحسب مقارنة بإجمالي نقاط الجميع في الفرعين. يمكنك تقييم الأعضاء التابعين لمجموعتك وفرعك فقط، ولا يمكنك تقييم نفسك.")}
              </p>
            </Card>

            <Card style={{ marginTop: 14 }}>
              <h3>{tr("أعضاء الفريق وتقييماتهم")}</h3>

              <DataTable
                columns={columns}
                rows={data.members}
                searchText={(row) => `${row.name} ${row.email}`}
                rowClass={(row) => (row.isMe ? "me" : "")}
                emptyTitle={tr("لا يوجد أعضاء بعد")}
              />
            </Card>
          </>
        )}
      </Async>

      {dlg?.type === "points" && (
        <AddPointsDialog
          preUserId={dlg.userId}
          onDone={done}
          onClose={close}
        />
      )}

      {dlg?.type === "edit" && (
        <UserDialog
          user={{
            ...dlg.row,
            campus: user.campus,
            teams: [teamId],
          }}
          kind="member"
          onDone={done}
          onClose={close}
        />
      )}
    </>
  );
}