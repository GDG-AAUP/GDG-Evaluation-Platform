import { tr } from "../i18n/index.js";
import { useAsync } from "../hooks/useAsync.js";
import { pointsApi } from "../services/index.js";
import { fmtDateTime, monthLabel } from "../lib/format.js";
import DataTable from "../components/ui/DataTable.jsx";
import { Card, Grid, MetricCard, PageHeader } from "../components/ui/Primitives.jsx";
import { Async } from "../components/ui/States.jsx";

/**
 * "My points" with the real backend: the member's own point history (GET /points/me, last 50 entries).
 * The performance scorecard and the activity share of the mock version have no backend yet.
 */
export default function MyPointsLedger() {
  const state = useAsync(() => pointsApi.getMyPoints(), []);

  const columns = [
    { title: tr("التاريخ"), sort: (e) => e.ts, render: (e) => fmtDateTime(e.ts) },
    { title: tr("النشاط"), render: (e) => e.activityName || "—" },
    { title: tr("السبب"), render: (e) => e.reason || "—" },
    { title: tr("النقاط"), sort: (e) => e.value, render: (e) => <b dir="ltr">{e.value > 0 ? `+${e.value}` : e.value}</b> },
  ];

  return (
    <>
      <PageHeader
        title={tr("نقاطي")}
        subtitle={tr("آخر 50 عملية على نقاطك")}
      />
      <Async state={state}>
        {(data) => (
          <>
            <Grid>
              <MetricCard icon="star" value={<span dir="ltr">{data.total}</span>} label={tr("مجموع نقاط {month}", { month: monthLabel(data.month) })} />
              <MetricCard icon="trending-up" value={<span dir="ltr">{data.positive}</span>} label={tr("نقاط مكتسبة")} />
              <MetricCard icon="trending-down" value={<span dir="ltr">{data.negative}</span>} label={tr("نقاط مخصومة")} />
            </Grid>
            <Card>
              <DataTable
                columns={columns}
                rows={data.entries}
                searchText={(e) => `${e.activityName} ${e.reason}`}
                emptyTitle={tr("لا توجد عمليات نقاط بعد")}
              />
            </Card>
          </>
        )}
      </Async>
    </>
  );
}
