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

export default function Managers() {
  const toast = useToast();
  const state = useAsync(() => usersApi.listUsers({ role: 'manager' }), []);
  const [dlg, setDlg] = useState(null);
  const close = () => setDlg(null);
  const done = () => state.reload({ silent: true });

  const columns = [
    { title: 'الاسم', sort: (u) => u.name, render: (u) => <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Avatar name={u.name} /><div>{u.name}<div className="sub" dir="ltr" style={{ textAlign: 'start' }}>{u.email}</div></div></div> },
    { title: 'الحرم', sort: (u) => u.campus, render: (u) => <CampusBadge campus={u.campus} /> },
    { title: 'الفرق المُسندة', render: (u) => u.teamsLabel },
    { title: 'الحالة', render: (u) => <UserStatusBadge status={u.status} /> },
    {
      title: 'إجراءات',
      render: (u) => (
        <div className="ia">
          <IconButton icon="edit" label="تعديل المدير" onClick={() => setDlg({ type: 'edit', u })} />
          <IconButton icon={u.status === 'active' ? 'user-off' : 'user-check'} label={u.status === 'active' ? 'تعطيل' : 'تفعيل'} onClick={() => setDlg({ type: 'toggle', u })} />
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="المديرون" subtitle="إدارة المديرين وتعيينهم على الفرق" crumb="المديرون" actions={<Button variant="primary" icon="user-plus" onClick={() => setDlg({ type: 'add' })}>إضافة مدير</Button>} />
      <Card>
        <Async state={state}>{(rows) => <DataTable columns={columns} rows={rows} searchText={(u) => `${u.name} ${u.email}`} />}</Async>
      </Card>
      {dlg && dlg.type === 'add' && <UserDialog kind="manager" onDone={done} onClose={close} />}
      {dlg && dlg.type === 'edit' && <UserDialog user={dlg.u} kind="manager" onDone={done} onClose={close} />}
      {dlg && dlg.type === 'toggle' && (
        <ReasonDialog
          title={dlg.u.status === 'active' ? 'تعطيل الحساب' : 'إعادة تفعيل الحساب'} danger={dlg.u.status === 'active'}
          confirmLabel={dlg.u.status === 'active' ? 'تعطيل' : 'تفعيل'} description={<b>{dlg.u.name}</b>} onClose={close}
          onConfirm={async (r) => { await usersApi.toggleUserStatus(dlg.u.id, r); toast.success('تم التحديث'); done(); }}
        />
      )}
    </>
  );
}
