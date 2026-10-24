import { useState } from 'react';
import { useAppData, usePolicies } from '../../context/AppDataContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { CAMPUS, CAMPUS_KEYS } from '../../lib/constants.js';
import { teamsApi } from '../../services/index.js';
import { Badge, CampusBadge } from '../../components/ui/Badges.jsx';
import { Dialog, DialogActions, ReasonDialog } from '../../components/ui/Dialog.jsx';
import { Field } from '../../components/ui/Form.jsx';
import { Button, Card, Grid, PageHeader } from '../../components/ui/Primitives.jsx';
import { Async } from '../../components/ui/States.jsx';

function TeamDialog({ team, campus, onDone, onClose }) {
  const toast = useToast();
  const { multipleManagersPerTeam } = usePolicies();
  const c = team ? team.campus : campus;
  const mgrs = useAsync(() => teamsApi.listCampusManagers(c), [c]);
  const [name, setName] = useState(team ? team.name : '');
  const [chosen, setChosen] = useState(team ? team.managers.map((m) => m.id) : []);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = (id) => setChosen((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  const save = async () => {
    setBusy(true); setErr('');
    try {
      await teamsApi.saveTeam({ id: team && team.id, campus: c, name, managerIds: chosen });
      toast.success('تم الحفظ');
      onDone();
      onClose();
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  const list = mgrs.data || [];

  return (
    <Dialog title={team ? 'تعديل فريق' : `فريق جديد في ${CAMPUS[c]}`} onClose={onClose}>
      <Field label="اسم الفريق">{(id) => <input id={id} type="text" value={name} placeholder="مثال: Design" onChange={(e) => { setName(e.target.value); setErr(''); }} />}</Field>
      <div className="f">
        <label>{multipleManagersPerTeam ? 'المديرون' : 'المدير'}</label>
        {multipleManagersPerTeam ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {list.map((m) => (
              <label key={m.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14, color: 'var(--tx)' }}>
                <input type="checkbox" checked={chosen.includes(m.id)} onChange={() => toggle(m.id)} />{m.name}
              </label>
            ))}
          </div>
        ) : (
          <select aria-label="المدير" value={chosen[0] || ''} onChange={(e) => setChosen(e.target.value ? [e.target.value] : [])}>
            <option value="">بدون مدير</option>
            {list.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      <DialogActions>
        <Button variant="primary" onClick={save} disabled={busy || mgrs.loading}>حفظ</Button>
        <Button onClick={onClose}>إلغاء</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function Campuses() {
  const toast = useToast();
  const { reload: reloadMeta } = useAppData();
  const state = useAsync(() => teamsApi.listTeams(), []);
  const [dlg, setDlg] = useState(null); // {type:'edit'|'toggle', team?, campus?}
  const done = () => { state.reload({ silent: true }); reloadMeta().catch(() => {}); };

  return (
    <>
      <PageHeader title="الحرمان والفرق" subtitle="إدارة الحرمين والفرق وتعيين المديرين" crumb="الحرمان والفرق" />
      <Async state={state}>
        {(teams) => (
          <Grid two>
            {CAMPUS_KEYS.map((c) => (
              <Card key={c}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <h3 style={{ margin: 0 }}><CampusBadge campus={c} /> حرم {CAMPUS[c]}</h3>
                  <Button small icon="plus" onClick={() => setDlg({ type: 'edit', campus: c })}>فريق جديد</Button>
                </div>
                {teams.filter((t) => t.campus === c).map((t) => (
                  <div className="le" key={t.id}>
                    <div style={{ flex: 1 }}>
                      <b>{t.name}</b> {t.status === 'active' ? <Badge tone="g">فعّال</Badge> : <Badge tone="y">معطّل</Badge>}
                      <div className="sub">المدير: {t.managers.map((m) => m.name).join('، ') || 'غير معيّن'} · {t.activeMembers} أعضاء</div>
                    </div>
                    <div className="ia" style={{ gap: 6 }}>
                      <Button small onClick={() => setDlg({ type: 'edit', team: t })}>تعديل</Button>
                      <Button small onClick={() => setDlg({ type: 'toggle', team: t })}>{t.status === 'active' ? 'تعطيل' : 'تفعيل'}</Button>
                    </div>
                  </div>
                ))}
              </Card>
            ))}
          </Grid>
        )}
      </Async>
      {dlg && dlg.type === 'edit' && <TeamDialog team={dlg.team} campus={dlg.campus} onDone={done} onClose={() => setDlg(null)} />}
      {dlg && dlg.type === 'toggle' && (
        <ReasonDialog
          title={dlg.team.status === 'active' ? 'تعطيل الفريق' : 'تفعيل الفريق'} danger={dlg.team.status === 'active'}
          confirmLabel={dlg.team.status === 'active' ? 'تعطيل' : 'تفعيل'}
          description={<b>{dlg.team.name} - {CAMPUS[dlg.team.campus]}</b>}
          onClose={() => setDlg(null)}
          onConfirm={async (r) => { await teamsApi.toggleTeam(dlg.team.id, r); toast.success('تم التحديث'); done(); }}
        />
      )}
    </>
  );
}
