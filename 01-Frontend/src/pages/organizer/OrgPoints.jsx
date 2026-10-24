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
    ["", "كل الفرق"],
    ...meta.teams
      .filter((team) => team.campus === branch)
      .map((team) => [
        team.id,
        `${CAMPUS[team.campus]} · ${team.name}`,
      ]),
  ];

  const columns = [
    {
      title: "التاريخ",
      sort: (row) => row.ts,
      render: (row) => fmtDateTime(row.ts),
    },
    {
      title: "الشهر",
      sort: (row) => row.month,
      render: (row) => monthLabel(row.month),
    },
    {
      title: "العضو",
      sort: (row) => row.userName,
      render: (row) => row.userName,
    },
    {
      title: "الفريق والفرع",
      render: (row) => (
        <>
          {row.teamsLabel}
          <div className="sub">{CAMPUS[row.campus]}</div>
        </>
      ),
    },
    {
      title: "نوع السجل",
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
          {TYPE_LABEL[row.type]}
        </Badge>
      ),
    },
    {
      title: "الأداء / 100",
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
      title: "نقاط النشاط",
      sort: (row) => row.activityPoints ?? -1,
      render: (row) =>
        row.activityPoints === null ? (
          <span className="sub">—</span>
        ) : (
          <b>{row.activityPoints}</b>
        ),
    },
    {
      title: "النقاط القديمة",
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
      title: "النشاط / البيان",
      render: (row) => (
        <>
          <strong>{row.label}</strong>

          {row.revision !== null && (
            <div className="sub">
              إصدار بطاقة الأداء: {row.revision}
            </div>
          )}
        </>
      ),
    },
    {
      title: "السبب / شرح النشاط",
      render: (row) => (
        <div
          style={{
            minWidth: 180,
            maxWidth: 350,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {row.reason}
        </div>
      ),
    },
    {
      title: "المنفذ",
      render: (row) => row.actorName,
    },
    {
      title: "الشهر مفتوح / مؤرشف",
      render: (row) => (
        <Badge tone={row.archived ? "n" : "g"}>
          {row.archived ? "مؤرشف" : "مفتوح"}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="سجل التقييمات والنقاط"
        subtitle={`سجلات ${CAMPUS[branch]} — الأداء والأنشطة والنقاط القديمة`}
        crumb="السجل"
      />

      <FilterBar>
        <Select
          label="الشهر"
          value={month}
          onChange={setMonth}
          options={[
            ["", "كل الأشهر"],
            ...meta.months.map((item) => [
              item.id,
              monthLabel(item.id),
            ]),
          ]}
        />

        <Select
          label="الفرع"
          value={branch}
          onChange={(campus) => {
            setTeamFilter({ campus, id: "" });
            setBranch(campus);
          }}
          options={[
            ["jenin", "جنين"],
            ["ramallah", "رام الله"],
          ]}
        />

        <Select
          label="الفريق"
          value={teamId}
          onChange={(id) =>
            setTeamFilter({ campus: branch, id })
          }
          options={teamOptions}
        />

        <Select
          label="نوع السجل"
          value={kind}
          onChange={setKind}
          options={[
            ["", "كل السجلات"],
            ["performance", "تقييم الأداء"],
            ["activity", "تقييم الأنشطة"],
            ["legacy", "النقاط القديمة"],
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
              emptyTitle="لا توجد سجلات بهذه التصفية"
            />
          )}
        </Async>
      </Card>

      <Note icon="history">
        هذا سجل للقراءة فقط. تقييم الأداء ونقاط الأنشطة
        والنقاط القديمة تظهر في أعمدة مستقلة ولا تُجمع معًا.
        إصدارات الأداء السابقة محفوظة للتوثيق؛ آخر إصدار
        هو المعتمد. كل صف نشاط يمثل نقاط ذلك النشاط فقط.
      </Note>
    </>
  );
}