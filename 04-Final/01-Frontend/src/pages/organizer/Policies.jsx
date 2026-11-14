import { useAppData } from '../../context/AppDataContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { USE_MOCK } from '../../config.js';
import { GOVERNANCE_FLAGS, isSuperAdmin } from '../../lib/governance.js';
import { POLICY_FIELDS } from '../../lib/policyMeta.js';
import { governanceApi, metaApi } from '../../services/index.js';
import { Switch } from '../../components/ui/Form.jsx';
import { Card, Note, PageHeader } from '../../components/ui/Primitives.jsx';
import { Async } from '../../components/ui/States.jsx';
import { useState } from 'react';
import { tr } from '../../i18n/index.js';

/**
 * Super Admin only: the three governance flags (GET/PATCH /api/governance/settings). Each change is
 * audited on the server with the actor, the before/after values and the time.
 */
function GovernanceCard() {
  const toast = useToast();
  const state = useAsync(() => governanceApi.getGovernance(), []);
  const [saving, setSaving] = useState('');

  const save = async (key, value) => {
    setSaving(key);
    try {
      await governanceApi.setGovernance({ [key]: value });
      toast.success(tr('تم تحديث صلاحيات الحوكمة'));
      await state.reload({ silent: true });
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving('');
    }
  };

  return (
    <Card style={{ marginBottom: 14 }}>
      <h3>{tr('صلاحيات الحوكمة')} <span className="sub">Governance Controls</span></h3>
      <Async state={state}>
        {(g) => (
          <>
            {GOVERNANCE_FLAGS.map((flag) => (
              <div className="pol" key={flag.key}>
                <div><b>{tr(flag.label)}</b><p>{tr(flag.hint)}</p></div>
                <Switch label={tr(flag.label)} checked={!!g[flag.key]} onChange={(v) => { if (!saving) save(flag.key, v); }} />
              </div>
            ))}
            <Note>{tr('تظهر هذه الإعدادات للمشرف العام فقط، وتُطبَّق على الخادم فورًا، ويُسجَّل كل تغيير في سجل التدقيق.')}</Note>
          </>
        )}
      </Async>
    </Card>
  );
}

function NumberControl({ field, value, onSave }) {
  const [v, setV] = useState(String(value));
  return (
    <input
      type="number" min="1" max="1000" style={{ width: 100 }} aria-label={tr(field.label)} value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v !== String(value)) onSave(Number(v)).catch(() => setV(String(value))); }}
    />
  );
}

/** Open management decisions as live switches (changes apply instantly, audited). */
export default function Policies() {
  const { policies, setPolicies } = useAppData();
  const { user } = useAuth();
  const toast = useToast();

  const save = async (key, value) => {
    try {
      setPolicies(await metaApi.setPolicy(key, value));
      toast.success(tr('تم تحديث السياسة'));
    } catch (e) { toast.error(e); throw e; }
  };

  return (
    <>
      <PageHeader title={tr('السياسات')} subtitle={tr('قرارات الإدارة المفتوحة. أي تغيير يسري فورًا على سلوك المنصة')} crumb={tr('السياسات')} />
      {!USE_MOCK && isSuperAdmin(user) && <GovernanceCard />}
      <Card>
        {POLICY_FIELDS.map((p) => (
          <div className="pol" key={p.key}>
            <div><b>{tr(p.label)}</b><p>{tr(p.hint)}</p></div>
            {p.type === 'switch' && <Switch label={tr(p.label)} checked={!!policies[p.key]} onChange={(v) => save(p.key, v).catch(() => {})} />}
            {p.type === 'number' && <NumberControl key={policies[p.key]} field={p} value={policies[p.key]} onSave={(v) => save(p.key, v)} />}
          </div>
        ))}
      </Card>
    </>
  );
}
