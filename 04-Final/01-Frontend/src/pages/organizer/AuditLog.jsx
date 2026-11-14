import { useState } from "react";
import { useAsync } from "../../hooks/useAsync.js";
import { fmtDateTime } from "../../lib/format.js";
import { logsApi } from "../../services/index.js";
import { Badge } from "../../components/ui/Badges.jsx";
import DataTable from "../../components/ui/DataTable.jsx";
import {
  Dialog,
  DialogActions,
} from "../../components/ui/Dialog.jsx";
import {
  FilterBar,
  Select,
} from "../../components/ui/Form.jsx";
import {
  Button,
  Card,
  PageHeader,
} from "../../components/ui/Primitives.jsx";
import { Async } from "../../components/ui/States.jsx";
import { tr } from '../../i18n/index.js';

const TYPES = {
  performance: {
    label: "تقييم الأداء",
    tone: "b",
  },
  activity: {
    label: "تقييم الأنشطة",
    tone: "g",
  },
  admin: {
    label: "عملية إدارية",
    tone: "n",
  },
};

function recordType(record) {
  const action = String(record.action || "");

  if (
    record.entityType === "أنشطة" ||
    action.includes("تقييم نشاط")
  ) {
    return "activity";
  }

  if (
    action.includes("بطاقة تقييم") ||
    action.includes("بطاقة أداء") ||
    action.includes("تقييم الأداء")
  ) {
    return "performance";
  }

  return "admin";
}

function displayValue(value, type) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ""
  ) {
    return "—";
  }

  const text = String(value).trim();
  const number = Number(text);

  if (text !== "—" && Number.isFinite(number)) {
    if (type === "performance") {
      return `${number.toFixed(2)} / 100`;
    }

    if (type === "activity") {
      return tr("{n} نقطة", { n: number });
    }
  }

  return tr(text);
}

function TypeBadge({ record }) {
  const type = TYPES[recordType(record)];

  return <Badge tone={type.tone}>{tr(type.label)}</Badge>;
}

export default function AuditLog() {
  const [filters, setFilters] = useState({
    actorId: "",
    action: "",
    entityType: "",
    from: "",
    to: "",
  });

  const [category, setCategory] = useState("");
  const [view, setView] = useState(null);

  const set = (key) => (value) =>
    setFilters((previous) => ({
      ...previous,
      [key]: value,
    }));

  const state = useAsync(
    () => logsApi.getAuditLog(filters),
    [filters],
  );

  const options = (first, items, map = (item) => [item, tr(item)]) => [
    ["", first],
    ...items.map(map),
  ];

  function resetFilters() {
    setFilters({
      actorId: "",
      action: "",
      entityType: "",
      from: "",
      to: "",
    });

    setCategory("");
  }

  const columns = [
    {
      title: tr("الوقت"),
      sort: (record) => record.ts,
      render: (record) => fmtDateTime(record.ts),
    },
    {
      title: tr("نوع العملية"),
      render: (record) => <TypeBadge record={record} />,
    },
    {
      title: tr("المنفذ"),
      sort: (record) => record.actorName,
      render: (record) => record.actorName,
    },
    {
      title: tr("الإجراء"),
      sort: (record) => record.action,
      render: (record) => tr(record.action),
    },
    {
      title: tr("الشخص / الكيان"),
      render: (record) => (
        <>
          <strong>{tr(record.entity)}</strong>
          <div className="sub">{tr(record.entityType)}</div>
        </>
      ),
    },
    {
      title: tr("القيمة السابقة"),
      render: (record) => {
        const type = recordType(record);

        return (
          <span dir="auto">
            {displayValue(record.before, type)}
          </span>
        );
      },
    },
    {
      title: tr("القيمة المسجلة"),
      render: (record) => {
        const type = recordType(record);

        return (
          <strong dir="auto">
            {displayValue(record.after, type)}
          </strong>
        );
      },
    },
    {
      title: tr("السبب / شرح النشاط"),
      render: (record) => (
        <div className="audit-reason-preview">
          {tr(record.reason || "—")}
        </div>
      ),
    },
    {
      title: tr("التفاصيل"),
      render: (record) => (
        <Button small onClick={() => setView(record)}>
          {tr("عرض التفاصيل")}
        </Button>
      ),
    },
  ];

  return (
    <div className="audit-rating-page">
      <PageHeader
        title={tr("سجل التدقيق")}
        subtitle={tr("تتبّع تقييمات الأداء والأنشطة والعمليات الإدارية — للقراءة فقط")}
        crumb={tr("سجل التدقيق")}
      />

      <FilterBar>
        <Select
          label={tr("نوع العملية")}
          value={category}
          onChange={setCategory}
          options={[
            ["", tr("كل العمليات")],
            ["performance", tr("تقييم الأداء")],
            ["activity", tr("تقييم الأنشطة")],
            ["admin", tr("العمليات الإدارية")],
          ]}
        />

        <Select
          label={tr("المنفذ")}
          value={filters.actorId}
          onChange={set("actorId")}
          options={options(
            tr("كل المنفذين"),
            state.data?.filters?.actors || [],
            (actor) => [actor.id, actor.name],
          )}
        />

        <Select
          label={tr("الإجراء")}
          value={filters.action}
          onChange={set("action")}
          options={options(
            tr("كل الإجراءات"),
            state.data?.filters?.actions || [],
          )}
        />

        <Select
          label={tr("الكيان")}
          value={filters.entityType}
          onChange={set("entityType")}
          options={options(
            tr("كل الكيانات"),
            state.data?.filters?.entityTypes || [],
          )}
        />

        <label className="f">
          {tr("من تاريخ")}
          <input
            type="date"
            value={filters.from}
            onChange={(event) => set("from")(event.target.value)}
          />
        </label>

        <label className="f">
          {tr("إلى تاريخ")}
          <input
            type="date"
            value={filters.to}
            onChange={(event) => set("to")(event.target.value)}
          />
        </label>

        <Button onClick={resetFilters}>
          {tr("مسح التصفية")}
        </Button>
      </FilterBar>

      <Async state={state}>
        {(data) => {
          const items = data.items || [];

          const rows = category
            ? items.filter(
                (record) => recordType(record) === category,
              )
            : items;

          const performanceCount = items.filter(
            (record) => recordType(record) === "performance",
          ).length;

          const activityCount = items.filter(
            (record) => recordType(record) === "activity",
          ).length;

          const adminCount = items.filter(
            (record) => recordType(record) === "admin",
          ).length;

          return (
            <>
              <div className="audit-category-cards">
                {[
                  ["performance", performanceCount],
                  ["activity", activityCount],
                  ["admin", adminCount],
                ].map(([type, count]) => (
                  <button
                    key={type}
                    type="button"
                    className={`audit-category-card audit-${type}`}
                    aria-pressed={category === type}
                    onClick={() =>
                      setCategory((previous) =>
                        previous === type ? "" : type,
                      )
                    }
                  >
                    <span>{tr(TYPES[type].label)}</span>
                    <strong>{count}</strong>
                    <small>{tr("عملية مسجلة")}</small>
                  </button>
                ))}
              </div>

              <p className="sub">
                {tr("الأعداد تخص السجلات المُحمّلة ضمن فلاتر المنفذ والإجراء والكيان والتاريخ. وهي أعداد عمليات، وليست مجموع درجات أو نقاط.")}
              </p>

              <Card>
                <DataTable
                  columns={columns}
                  rows={rows}
                  searchText={(record) =>
                    [
                      record.action,
                      record.entity,
                      record.reason,
                      record.actorName,
                      TYPES[recordType(record)].label,
                    ].join(" ")
                  }
                  emptyTitle={tr("لا توجد عمليات بهذه التصفية")}
                />
              </Card>
            </>
          );
        }}
      </Async>

      {view && (
        <Dialog
          title={tr("تفاصيل العملية")}
          onClose={() => setView(null)}
        >
          <div style={{ marginBottom: 14 }}>
            <TypeBadge record={view} />
          </div>

          <h3 style={{ margin: "0 0 8px" }}>
            {tr(view.action)}
          </h3>

          <p>{tr(view.entity)}</p>

          <div className="sub" style={{ marginBottom: 16 }}>
            {view.actorName} · {fmtDateTime(view.ts)}
          </div>

          <div className="dif">
            <div className="a">
              <div className="sub">{tr("القيمة السابقة")}</div>
              <span dir="auto">
                {displayValue(view.before, recordType(view))}
              </span>
            </div>

            <div className="c">
              <div className="sub">{tr("القيمة المسجلة")}</div>
              <strong dir="auto">
                {displayValue(view.after, recordType(view))}
              </strong>
            </div>
          </div>

          <div className="audit-detail-reason">
            <strong>
              {recordType(view) === "activity"
                ? tr("النشاط وشرحه")
                : tr("السبب")}
            </strong>

            <p>{tr(view.reason || "—")}</p>
          </div>

          {recordType(view) === "activity" && (
            <p className="sub">
              {tr("القيمة المسجلة تخص هذا النشاط فقط، وليست مجموع أنشطة الشخص أو نسبة ترتيبه.")}
            </p>
          )}

          {recordType(view) === "performance" && (
            <p className="sub">
              {tr("هذه العملية تخص بطاقة الأداء فقط، وهي مستقلة عن نقاط الأنشطة.")}
            </p>
          )}

          <DialogActions>
            <Button onClick={() => setView(null)}>
              {tr("إغلاق")}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </div>
  );
}