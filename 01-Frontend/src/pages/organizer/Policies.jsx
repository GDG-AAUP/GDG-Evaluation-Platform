import { useAppData } from '../../context/AppDataContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { POLICY_FIELDS } from '../../lib/policyMeta.js';
import { metaApi } from '../../services/index.js';
import { Switch } from '../../components/ui/Form.jsx';
import { Card, PageHeader } from '../../components/ui/Primitives.jsx';
import { useState } from 'react';
import { tr } from '../../i18n/index.js';

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
