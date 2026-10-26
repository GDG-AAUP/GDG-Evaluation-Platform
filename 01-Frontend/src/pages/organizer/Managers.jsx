import { useState } from 'react';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { usersApi } from '../../services/index.js';
import UserDialog from '../../components/domain/UserDialog.jsx';
import { CampusBadge, UserStatusBadge } from '../../components/ui/Badges.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { ReasonDialog } from '../../components/ui/Dialog.jsx';
import { Avatar, Button, Card, IconButton, PageHeader } from '../../components/ui/Primitives.jsx';
import { Async } from '../../components/ui/States.jsx';
import { tr } from '../../i18n/index.js';

export default function Managers() {
  const toast = useToast();
  const state = useAsync(() => usersApi.listUsers({ role: 'manager' }), []);
  const [dlg, setDlg] = useState(null);
  const close = () => setDlg(null);
  const done = () => state.reload({ silent: true });

  const columns = [
    { title: tr('الاسم'), sort: (u) => u.name, render: (u) => <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Avatar name={u.name} /><div>{u.name}<div className="sub" dir="ltr" style={{ textAlign: 'start' }}>{u.email}</div></div></div> },
    { title: tr('الحرم'), sort: (u) => u.campus, render: (u) => <CampusBadge campus={u.campus} /> },
    { title: tr('الفرق المُسندة'), render: (u) => tr(u.teamsLabel) },
    { title: tr('الحالة'), render: (u) => <UserStatusBadge status={u.status} /> },
    {
      title: tr('إجراءات'),
      render: (u) => (
        <div className="ia">
          <IconButton icon="edit" label={tr('تعديل المدير')} onClick={() => setDlg({ type: 'edit', u })} />
          <IconButton icon={u.status === 'active' ? 'user-off' : 'user-check'} label={u.status === 'active' ? tr('تعطيل') : tr('تفعيل')} onClick={() => setDlg({ type: 'toggle', u })} />
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={tr('المديرون')} subtitle={tr('إدارة المديرين وتعيينهم على الفرق')} crumb={tr('المديرون')} actions={<Button variant="primary" icon="user-plus" onClick={() => setDlg({ type: 'add' })}>{tr('إضافة مدير')}</Button>} />
      <Card>
        <Async state={state}>{(rows) => <DataTable columns={columns} rows={rows} searchText={(u) => `${u.name} ${u.email}`} />}</Async>
      </Card>
      {dlg && dlg.type === 'add' && <UserDialog kind="manager" onDone={done} onClose={close} />}
      {dlg && dlg.type === 'edit' && <UserDialog user={dlg.u} kind="manager" onDone={done} onClose={close} />}
      {dlg && dlg.type === 'toggle' && (
        <ReasonDialog
          title={dlg.u.status === 'active' ? tr('تعطيل الحساب') : tr('إعادة تفعيل الحساب')} danger={dlg.u.status === 'active'}
          confirmLabel={dlg.u.status === 'active' ? tr('تعطيل') : tr('تفعيل')} description={<b>{dlg.u.name}</b>} onClose={close}
          onConfirm={async (r) => { await usersApi.toggleUserStatus(dlg.u.id, r); toast.success(tr('تم التحديث')); done(); }}
        />
      )}
    </>
  );
}
