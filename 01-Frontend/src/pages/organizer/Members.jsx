import { useState } from 'react';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { CAMPUS } from '../../lib/constants.js';
import { usersApi } from '../../services/index.js';
import UserDialog from '../../components/domain/UserDialog.jsx';
import { Badge, CampusBadge, RoleBadge, UserStatusBadge } from '../../components/ui/Badges.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { ConfirmDialog, ReasonDialog } from '../../components/ui/Dialog.jsx';
import { FilterBar, Segmented, Select } from '../../components/ui/Form.jsx';
import { Avatar, Button, Card, IconButton, PageHeader } from '../../components/ui/Primitives.jsx';
import { Async } from '../../components/ui/States.jsx';

export default function Members() {
  const { user: me } = useAuth();
  const { meta } = useAppData();
  const toast = useToast();
  const [f, setF] = useState({ tab: 'active', campus: '', teamId: '', role: 'member', status: '' });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v, ...(k === 'campus' ? { teamId: '' } : {}) }));
  const deleted = f.tab === 'deleted';
  const state = useAsync(() => usersApi.listUsers({ role: f.role, campus: f.campus, teamId: f.teamId, status: f.status, deleted }), [f]);
  const [dlg, setDlg] = useState(null);
  const close = () => setDlg(null);
  const done = () => state.reload({ silent: true });

  const teamOpts = [['', 'كل الفرق'], ...(meta ? meta.teams : []).filter((t) => !f.campus || t.campus === f.campus).map((t) => [t.id, `${CAMPUS[t.campus]} · ${t.name}`])];

  const columns = [
    {
      title: 'الاسم', sort: (u) => u.name,
      render: (u) => (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Avatar name={u.name} />
          <div>{u.name}{u.id === me.id && <> <Badge tone="b">أنت</Badge></>}<div className="sub" dir="ltr" style={{ textAlign: 'start' }}>{u.email}</div></div>
        </div>
      ),
    },
    { title: 'الحرم', sort: (u) => u.campus, render: (u) => <CampusBadge campus={u.campus} /> },
    { title: 'الفريق', sort: (u) => u.teamsLabel, render: (u) => u.teamsLabel },
    { title: 'الدور', sort: (u) => u.role, render: (u) => <RoleBadge role={u.role} /> },
    { title: 'الحالة', render: (u) => <UserStatusBadge status={u.status} /> },
    {
      title: 'إجراءات',
      render: (u) => (u.status === 'deleted' ? <Button small onClick={() => setDlg({ type: 'restore', u })}>استرجاع</Button> : (
        <div className="ia">
          <IconButton icon="edit" label="تعديل" onClick={() => setDlg({ type: 'edit', u })} />
          <IconButton icon={u.status === 'active' ? 'user-off' : 'user-check'} label={u.status === 'active' ? 'تعطيل' : 'تفعيل'} onClick={() => setDlg({ type: 'toggle', u })} />
          <IconButton icon="trash" label="حذف ناعم" onClick={() => setDlg({ type: 'delete', u })} />
        </div>
      )),
    },
  ];

  return (
    <>
      <PageHeader title="الأعضاء" subtitle="إدارة المستخدمين، التعطيل، الحذف الناعم والاسترجاع" crumb="الأعضاء" actions={<Button variant="primary" icon="user-plus" onClick={() => setDlg({ type: 'add' })}>إضافة مستخدم</Button>} />
      <Segmented style={{ marginBottom: 10 }} value={f.tab} onChange={set('tab')} options={[['active', 'القائمة'], ['deleted', 'المحذوفون']]} />
      <FilterBar>
        <Select label="الحرم" value={f.campus} onChange={set('campus')} options={[['', 'كل الحرمين'], ['jenin', 'جنين'], ['ramallah', 'رام الله']]} />
        <Select label="الفريق" value={f.teamId} onChange={set('teamId')} options={teamOpts} />
        <Select label="الدور" value={f.role} onChange={set('role')} options={[['', 'كل الأدوار'], ['member', 'Member'], ['manager', 'Manager'], ['organizer', 'Organizer']]} />
        {!deleted && <Select label="الحالة" value={f.status} onChange={set('status')} options={[['', 'كل الحالات'], ['active', 'نشط'], ['disabled', 'معطّل']]} />}
      </FilterBar>
      <Card>
        <Async state={state}>
          {(rows) => <DataTable columns={columns} rows={rows} searchText={(u) => `${u.name} ${u.email}`} emptyTitle={deleted ? 'لا يوجد محذوفون' : 'لا يوجد أعضاء بهذه التصفية'} />}
        </Async>
      </Card>

      {dlg && dlg.type === 'add' && <UserDialog kind="user" onDone={done} onClose={close} />}
      {dlg && dlg.type === 'edit' && <UserDialog user={dlg.u} kind={dlg.u.role === 'manager' ? 'manager' : 'user'} onDone={done} onClose={close} />}
      {dlg && dlg.type === 'toggle' && (
        <ReasonDialog
          title={dlg.u.status === 'active' ? 'تعطيل الحساب' : 'إعادة تفعيل الحساب'} danger={dlg.u.status === 'active'}
          confirmLabel={dlg.u.status === 'active' ? 'تعطيل' : 'تفعيل'} description={<b>{dlg.u.name}</b>} onClose={close}
          onConfirm={async (r) => { await usersApi.toggleUserStatus(dlg.u.id, r); toast.success(dlg.u.status === 'active' ? 'تم تعطيل الحساب' : 'تمت إعادة التفعيل'); done(); }}
        />
      )}
      {dlg && dlg.type === 'delete' && (
        <ReasonDialog
          title="حذف ناعم" danger confirmLabel="حذف" onClose={close}
          description={<>سيختفي <b>{dlg.u.name}</b> من القوائم وتبقى سجلاته محفوظة، ويمكن استرجاعه لاحقًا.</>}
          onConfirm={async (r) => { await usersApi.deleteUser(dlg.u.id, r); toast.success('تم الحذف الناعم'); done(); }}
        />
      )}
      {dlg && dlg.type === 'restore' && (
        <ConfirmDialog
          title="استرجاع الحساب" confirmLabel="استرجاع" onClose={close}
          message={<>سيعود <b>{dlg.u.name}</b> إلى القوائم بحالة معطّل حتى تفعّله.</>}
          onConfirm={async () => { await usersApi.restoreUser(dlg.u.id); toast.success('تم الاسترجاع'); done(); }}
        />
      )}
    </>
  );
}
