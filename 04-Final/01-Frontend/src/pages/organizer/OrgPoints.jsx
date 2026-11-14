import { useState } from "react";
import { useAppData } from "../../context/AppDataContext.jsx";
import { useBranch } from "../../context/BranchContext.jsx";
import { useAsync } from "../../hooks/useAsync.js";
import { CAMPUS } from "../../lib/constants.js";
import {
  fmtDateTime,
  monthLabel,
} from "../../lib/format.js";
import { ratingsApi } from "../../services/ratings.js";
import { Badge } from "../../components/ui/Badges.jsx";
import DataTable from "../../components/ui/DataTable.jsx";
import {
  FilterBar,
  Select,
} from "../../components/ui/Form.jsx";
import {
  Card,
  Note,
  PageHeader,
} from "../../components/ui/Primitives.jsx";
import { tr } from "../../i18n/index.js";
import {
  Async,
  Skeleton,
} from "../../components/ui/States.jsx";

const TYPE_LABEL = {
  performance: "تقييم الأداء",
  activity: "تقييم الأنشطة",
  legacy: "نقاط قديمة",
};

export default function OrgPoints() {
  const { meta } = useAppData();
  const { branch, setBranch } = useBranch();

  const [month, setMonth] = useState("");
  const [kind, setKind] = useState("");

  // Remember which branch a selected team belongs to.
  // Switching branch immediately clears an incompatible team filter.
  const [teamFilter, setTeamFilter] = useState({
    campus: branch,
    id: "",
  });

  const teamId =
    teamFilter.campus === branch ? teamFilter.id : "";

  const state = useAsync(
    () =>
      ratingsApi.ledger({
        month,
        campus: branch,
        teamId,
        kind,
      }),
    [month, branch, teamId, kind],
  );

  if (!meta) return <Skeleton />;

  const teamOptions = [
    ["", tr("كل الفرق")],
    ...meta.teams
      .filter((team) => team.campus === branch)
      .map((team) => [
        team.id,
        `${tr(CAMPUS[team.campus])} · ${tr(team.name)}`,
      ]),
  ];

  const columns = [
    {
      title: tr("التاريخ"),
      sort: (row) => row.ts,
      render: (row) => fmtDateTime(row.ts),
    },
    {
      title: tr("الشهر"),
      sort: (row) => row.month,
      render: (row) => monthLabel(row.month),
    },
    {
      title: tr("العضو"),
      sort: (row) => row.userName,
      render: (row) => row.userName,
    },
    {
      title: tr("الفريق والفرع"),
      render: (row) => (
        <>
          {tr(row.teamsLabel)}
          <div className="sub">{tr(CAMPUS[row.campus])}</div>
        </>
      ),
    },
    {
      title: tr("نوع السجل"),
      render: (row) => (
        <Badge
          tone={
            row.type === "performance"
              ? "b"
              : row.type === "activity"
                ? "g"
                : "n"
          }
        >
          {tr(TYPE_LABEL[row.type])}
        </Badge>
      ),
    },
    {
      title: tr("الأداء / 100"),
      sort: (row) => row.performance ?? -1,
      render: (row) =>
        row.performance === null ? (
          <span className="sub">—</span>
        ) : (
          <b dir="ltr">
            {Number(row.performance).toFixed(2)} / 100
          </b>
        ),
    },
    {
      title: tr("نقاط النشاط"),
      sort: (row) => row.activityPoints ?? -1,
      render: (row) =>
        row.activityPoints === null ? (
          <span className="sub">—</span>
        ) : (
          <b>{row.activityPoints}</b>
        ),
    },
    {
      title: tr("النقاط القديمة"),
      sort: (row) =>
        row.legacyPoints ?? Number.NEGATIVE_INFINITY,
      render: (row) =>
        row.legacyPoints === null ? (
          <span className="sub">—</span>
        ) : (
          <span dir="ltr">{row.legacyPoints}</span>
        ),
    },
    {
      title: tr("النشاط / البيان"),
      render: (row) => (
        <>
          <strong>{tr(row.label)}</strong>

          {row.revision !== null && (
            <div className="sub">
              {tr("إصدار بطاقة الأداء: {n}", { n: row.revision })}
            </div>
          )}
        </>
      ),
    },
    {
      title: tr("السبب / شرح النشاط"),
      render: (row) => (
        <div
          style={{
            minWidth: 180,
            maxWidth: 350,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {tr(row.reason)}
        </div>
      ),
    },
    {
      title: tr("المنفذ"),
      render: (row) => row.actorName,
    },
    {
      title: tr("الشهر مفتوح / مؤرشف"),
      render: (row) => (
        <Badge tone={row.archived ? "n" : "g"}>
          {row.archived ? tr("مؤرشف") : tr("مفتوح")}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={tr("سجل التقييمات والنقاط")}
        subtitle={tr("سجلات {campus} — الأداء والأنشطة والنقاط القديمة", { campus: tr(CAMPUS[branch]) })}
        crumb={tr("السجل")}
      />

      <FilterBar>
        <Select
          label={tr("الشهر")}
          value={month}
          onChange={setMonth}
          options={[
            ["", tr("كل الأشهر")],
            ...meta.months.map((item) => [
              item.id,
              monthLabel(item.id),
            ]),
          ]}
        />

        <Select
          label={tr("الفرع")}
          value={branch}
          onChange={(campus) => {
            setTeamFilter({ campus, id: "" });
            setBranch(campus);
          }}
          options={[
            ["jenin", tr("جنين")],
            ["ramallah", tr("رام الله")],
          ]}
        />

        <Select
          label={tr("الفريق")}
          value={teamId}
          onChange={(id) =>
            setTeamFilter({ campus: branch, id })
          }
          options={teamOptions}
        />

        <Select
          label={tr("نوع السجل")}
          value={kind}
          onChange={setKind}
          options={[
            ["", tr("كل السجلات")],
            ["performance", tr("تقييم الأداء")],
            ["activity", tr("تقييم الأنشطة")],
            ["legacy", tr("النقاط القديمة")],
          ]}
        />
      </FilterBar>

      <Card>
        <Async state={state}>
          {(rows) => (
            <DataTable
              columns={columns}
              rows={rows}
              searchText={(row) =>
                [
                  row.userName,
                  row.label,
                  row.reason,
                  row.actorName,
                  row.teamsLabel,
                ].join(" ")
              }
              emptyTitle={tr("لا توجد سجلات بهذه التصفية")}
            />
          )}
        </Async>
      </Card>

      <Note icon="history">
        {tr("هذا سجل للقراءة فقط. تقييم الأداء ونقاط الأنشطة والنقاط القديمة تظهر في أعمدة مستقلة ولا تُجمع معًا. إصدارات الأداء السابقة محفوظة للتوثيق؛ آخر إصدار هو المعتمد. كل صف نشاط يمثل نقاط ذلك النشاط فقط.")}
      </Note>
    </>
  );
}