import { useAppData } from '../../context/AppDataContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { POLICY_FIELDS } from '../../lib/policyMeta.js';
import { metaApi } from '../../services/index.js';
import { Switch } from '../../components/ui/Form.jsx';
import { Card, PageHeader } from '../../components/ui/Primitives.jsx';
import { useState } from 'react';

function NumberControl({ field, value, onSave }) {
  const [v, setV] = useState(String(value));
  return (
    <input
      type="number" min="1" max="1000" style={{ width: 100 }} aria-label={field.label} value={v}
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
      toast.success('تم تحديث السياسة');
    } catch (e) { toast.error(e); throw e; }
  };

  return (
    <>
      <PageHeader title="السياسات" subtitle="قرارات الإدارة المفتوحة. أي تغيير يسري فورًا على سلوك المنصة" crumb="السياسات" />
      <Card>
        {POLICY_FIELDS.map((p) => (
          <div className="pol" key={p.key}>
            <div><b>{p.label}</b><p>{p.hint}</p></div>
            {p.type === 'switch' && <Switch label={p.label} checked={!!policies[p.key]} onChange={(v) => save(p.key, v).catch(() => {})} />}
            {p.type === 'number' && <NumberControl key={policies[p.key]} field={p} value={policies[p.key]} onSave={(v) => save(p.key, v)} />}
          </div>
        ))}
      </Card>
    </>
  );
}
