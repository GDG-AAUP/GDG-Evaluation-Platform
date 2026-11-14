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
import { tr } from '../../i18n/index.js';

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
      toast.success(tr('تم الحفظ'));
      onDone();
      onClose();
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  const list = mgrs.data || [];

  return (
    <Dialog title={team ? tr('تعديل فريق') : tr('فريق جديد في {campus}', { campus: tr(CAMPUS[c]) })} onClose={onClose}>
      <Field label={tr('اسم الفريق')}>{(id) => <input id={id} type="text" value={name} placeholder={tr('مثال: Design')} onChange={(e) => { setName(e.target.value); setErr(''); }} />}</Field>
      <div className="f">
        <label>{multipleManagersPerTeam ? tr('المديرون') : tr('المدير')}</label>
        {multipleManagersPerTeam ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {list.map((m) => (
              <label key={m.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14, color: 'var(--tx)' }}>
                <input type="checkbox" checked={chosen.includes(m.id)} onChange={() => toggle(m.id)} />{m.name}
              </label>
            ))}
          </div>
        ) : (
          <select aria-label={tr('المدير')} value={chosen[0] || ''} onChange={(e) => setChosen(e.target.value ? [e.target.value] : [])}>
            <option value="">{tr('بدون مدير')}</option>
            {list.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      <DialogActions>
        <Button variant="primary" onClick={save} disabled={busy || mgrs.loading}>{tr('حفظ')}</Button>
        <Button onClick={onClose}>{tr('إلغاء')}</Button>
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
      <PageHeader title={tr('الحرمان والفرق')} subtitle={tr('إدارة الحرمين والفرق وتعيين المديرين')} crumb={tr('الحرمان والفرق')} />
      <Async state={state}>
        {(teams) => (
          <Grid two>
            {CAMPUS_KEYS.map((c) => (
              <Card key={c}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <h3 style={{ margin: 0 }}><CampusBadge campus={c} /> {tr('حرم {campus}', { campus: tr(CAMPUS[c]) })}</h3>
                  <Button small icon="plus" onClick={() => setDlg({ type: 'edit', campus: c })}>{tr('فريق جديد')}</Button>
                </div>
                {teams.filter((t) => t.campus === c).map((t) => (
                  <div className="le" key={t.id}>
                    <div style={{ flex: 1 }}>
                      <b>{t.name}</b> {t.status === 'active' ? <Badge tone="g">{tr('فعّال')}</Badge> : <Badge tone="y">{tr('معطّل')}</Badge>}
                      <div className="sub">{tr('المدير: {managers}', { managers: t.managers.map((m) => m.name).join('، ') || tr('غير معيّن') })} · {tr('{n} أعضاء', { n: t.activeMembers })}</div>
                    </div>
                    <div className="ia" style={{ gap: 6 }}>
                      <Button small onClick={() => setDlg({ type: 'edit', team: t })}>{tr('تعديل')}</Button>
                      <Button small onClick={() => setDlg({ type: 'toggle', team: t })}>{t.status === 'active' ? tr('تعطيل') : tr('تفعيل')}</Button>
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
          title={dlg.team.status === 'active' ? tr('تعطيل الفريق') : tr('تفعيل الفريق')} danger={dlg.team.status === 'active'}
          confirmLabel={dlg.team.status === 'active' ? tr('تعطيل') : tr('تفعيل')}
          description={<b>{dlg.team.name} - {tr(CAMPUS[dlg.team.campus])}</b>}
          onClose={() => setDlg(null)}
          onConfirm={async (r) => { await teamsApi.toggleTeam(dlg.team.id, r); toast.success(tr('تم التحديث')); done(); }}
        />
      )}
    </>
  );
}
