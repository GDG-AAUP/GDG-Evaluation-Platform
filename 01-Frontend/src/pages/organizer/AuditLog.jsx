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
      return `${number} نقطة`;
    }
  }

  return text;
}

function TypeBadge({ record }) {
  const type = TYPES[recordType(record)];

  return <Badge tone={type.tone}>{type.label}</Badge>;
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

  const options = (first, items, map = (item) => [item, item]) => [
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
      title: "الوقت",
      sort: (record) => record.ts,
      render: (record) => fmtDateTime(record.ts),
    },
    {
      title: "نوع العملية",
      render: (record) => <TypeBadge record={record} />,
    },
    {
      title: "المنفذ",
      sort: (record) => record.actorName,
      render: (record) => record.actorName,
    },
    {
      title: "الإجراء",
      sort: (record) => record.action,
      render: (record) => record.action,
    },
    {
      title: "الشخص / الكيان",
      render: (record) => (
        <>
          <strong>{record.entity}</strong>
          <div className="sub">{record.entityType}</div>
        </>
      ),
    },
    {
      title: "القيمة السابقة",
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
      title: "القيمة المسجلة",
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
      title: "السبب / شرح النشاط",
      render: (record) => (
        <div className="audit-reason-preview">
          {record.reason || "—"}
        </div>
      ),
    },
    {
      title: "التفاصيل",
      render: (record) => (
        <Button small onClick={() => setView(record)}>
          عرض التفاصيل
        </Button>
      ),
    },
  ];

  return (
    <div className="audit-rating-page">
      <PageHeader
        title="سجل التدقيق"
        subtitle="تتبّع تقييمات الأداء والأنشطة والعمليات الإدارية — للقراءة فقط"
        crumb="سجل التدقيق"
      />

      <FilterBar>
        <Select
          label="نوع العملية"
          value={category}
          onChange={setCategory}
          options={[
            ["", "كل العمليات"],
            ["performance", "تقييم الأداء"],
            ["activity", "تقييم الأنشطة"],
            ["admin", "العمليات الإدارية"],
          ]}
        />

        <Select
          label="المنفذ"
          value={filters.actorId}
          onChange={set("actorId")}
          options={options(
            "كل المنفذين",
            state.data?.filters?.actors || [],
            (actor) => [actor.id, actor.name],
          )}
        />

        <Select
          label="الإجراء"
          value={filters.action}
          onChange={set("action")}
          options={options(
            "كل الإجراءات",
            state.data?.filters?.actions || [],
          )}
        />

        <Select
          label="الكيان"
          value={filters.entityType}
          onChange={set("entityType")}
          options={options(
            "كل الكيانات",
            state.data?.filters?.entityTypes || [],
          )}
        />

        <label className="f">
          من تاريخ
          <input
            type="date"
            value={filters.from}
            onChange={(event) => set("from")(event.target.value)}
          />
        </label>

        <label className="f">
          إلى تاريخ
          <input
            type="date"
            value={filters.to}
            onChange={(event) => set("to")(event.target.value)}
          />
        </label>

        <Button onClick={resetFilters}>
          مسح التصفية
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
                    <span>{TYPES[type].label}</span>
                    <strong>{count}</strong>
                    <small>عملية مسجلة</small>
                  </button>
                ))}
              </div>

              <p className="sub">
                الأعداد تخص السجلات المُحمّلة ضمن فلاتر المنفذ
                والإجراء والكيان والتاريخ. وهي أعداد عمليات،
                وليست مجموع درجات أو نقاط.
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
                  emptyTitle="لا توجد عمليات بهذه التصفية"
                />
              </Card>
            </>
          );
        }}
      </Async>

      {view && (
        <Dialog
          title="تفاصيل العملية"
          onClose={() => setView(null)}
        >
          <div style={{ marginBottom: 14 }}>
            <TypeBadge record={view} />
          </div>

          <h3 style={{ margin: "0 0 8px" }}>
            {view.action}
          </h3>

          <p>{view.entity}</p>

          <div className="sub" style={{ marginBottom: 16 }}>
            {view.actorName} · {fmtDateTime(view.ts)}
          </div>

          <div className="dif">
            <div className="a">
              <div className="sub">القيمة السابقة</div>
              <span dir="auto">
                {displayValue(view.before, recordType(view))}
              </span>
            </div>

            <div className="c">
              <div className="sub">القيمة المسجلة</div>
              <strong dir="auto">
                {displayValue(view.after, recordType(view))}
              </strong>
            </div>
          </div>

          <div className="audit-detail-reason">
            <strong>
              {recordType(view) === "activity"
                ? "النشاط وشرحه"
                : "السبب"}
            </strong>

            <p>{view.reason || "—"}</p>
          </div>

          {recordType(view) === "activity" && (
            <p className="sub">
              القيمة المسجلة تخص هذا النشاط فقط، وليست مجموع
              أنشطة الشخص أو نسبة ترتيبه.
            </p>
          )}

          {recordType(view) === "performance" && (
            <p className="sub">
              هذه العملية تخص بطاقة الأداء فقط، وهي مستقلة
              عن نقاط الأنشطة.
            </p>
          )}

          <DialogActions>
            <Button onClick={() => setView(null)}>
              إغلاق
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </div>
  );
}