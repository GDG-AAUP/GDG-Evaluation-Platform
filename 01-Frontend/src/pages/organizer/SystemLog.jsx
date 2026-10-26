import { useState } from 'react';
import { useAsync } from '../../hooks/useAsync.js';
import { fmtDateTime } from '../../lib/format.js';
import { logsApi } from '../../services/index.js';
import { Badge } from '../../components/ui/Badges.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { Chips } from '../../components/ui/Form.jsx';
import { Banner, Card, PageHeader } from '../../components/ui/Primitives.jsx';
import { Async } from '../../components/ui/States.jsx';
import { tr } from '../../i18n/index.js';

const LEVEL = { error: ['r', 'خطأ'], warning: ['y', 'تحذير'], info: ['b', 'معلومة'] };

export default function SystemLog() {
  const [level, setLevel] = useState('all');
  const state = useAsync(() => logsApi.getSystemLog(level), [level]);
  const columns = [
    { title: tr('المستوى'), render: (x) => <Badge tone={LEVEL[x.level][0]}>{tr(LEVEL[x.level][1])}</Badge> },
    { title: tr('الرسالة'), render: (x) => tr(x.msg) },
    { title: tr('المصدر'), render: (x) => <code dir="ltr">{x.src}</code> },
    { title: tr('الوقت'), sort: (x) => x.ts, render: (x) => fmtDateTime(x.ts) },
  ];
  return (
    <>
      <PageHeader title="System Logs" subtitle={tr('أحداث تشغيلية وتقنية منفصلة عن Audit Log')} crumb="System Logs" />
      <Banner icon="shield">{tr('لا تُسجَّل بيانات حساسة مثل كلمات المرور أو المفاتيح.')}</Banner>
      <Chips value={level} onChange={setLevel} options={[['all', tr('الكل')], ['error', tr('أخطاء')], ['warning', tr('تحذيرات')], ['info', tr('معلومات')]]} />
      <Card><Async state={state}>{(rows) => <DataTable columns={columns} rows={rows} searchText={(x) => `${x.msg} ${x.src}`} emptyTitle={tr('لا توجد أحداث')} />}</Async></Card>
    </>
  );
}
