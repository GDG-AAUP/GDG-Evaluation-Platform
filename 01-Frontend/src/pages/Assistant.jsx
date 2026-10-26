import { useEffect, useRef, useState } from 'react';
import { tr } from '../i18n/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import { assistantApi } from '../services/index.js';
import { Badge } from '../components/ui/Badges.jsx';
import { Chips } from '../components/ui/Form.jsx';
import Icon from '../components/ui/Icon.jsx';
import { Button, Card, Note, PageHeader } from '../components/ui/Primitives.jsx';

const SUGG = {
  member: ['كم نقطة عندي هذا الشهر؟', 'كيف يُحسب الترتيب؟'],
  manager: ['كيف أضيف نقاطًا لعضو؟', 'كم نقاط فريقي هذا الشهر؟', 'كيف يُحسب الترتيب؟'],
  organizer: ['كيف أغلق الشهر؟', 'كم عدد الأعضاء في المنصة؟', 'كيف يُحسب الترتيب؟'],
};
const SCOPE = { member: 'بياناتك فقط', manager: 'فريقك', organizer: 'عام للمنصة' };

// Conversation kept per user while the app is open (survives page navigation).
const history = {};

export default function Assistant() {
  const { user } = useAuth();
  const [msgs, setMsgs] = useState(() => history[user.id] || [{ r: 'b', g: user.name.split(' ')[0] }]);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const box = useRef(null);

  useEffect(() => { history[user.id] = msgs; }, [msgs, user.id]);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [msgs, typing]);

  const ask = async (q) => {
    setMsgs((m) => [...m.filter((x) => x.r !== 'e'), { r: 'u', t: q }]);
    setTyping(true);
    try {
      const { answer } = await assistantApi.askAssistant(q);
      setMsgs((m) => [...m, { r: 'b', t: answer }]);
    } catch (e) {
      setMsgs((m) => [...m, { r: 'e', t: 'تعذّر الحصول على إجابة. جرّب مرة أخرى.', q }]);
    } finally { setTyping(false); }
  };

  const send = () => {
    const v = text.trim();
    if (!v) { setErr(tr('اكتب سؤالك أولًا.')); return; }
    setErr(''); setText(''); ask(v);
  };

  return (
    <>
      <PageHeader title={tr("المساعد")} subtitle={tr("مساعد المنصة")} actions={<Badge tone="b"><Icon name="shield" /> {tr("نطاق المساعد: {scope}", { scope: tr(SCOPE[user.role]) })}</Badge>} />
      <Card>
        <Chips value={null} onChange={ask} options={SUGG[user.role].map((s) => [s, tr(s)])} />
        <div className="chat" ref={box} role="log" aria-live="polite">
          {msgs.map((m, i) => (
            <div key={i} className={`bub ${m.r}`}>
              {m.g !== undefined ? tr('مرحبًا {name}. اسألني عن النظام أو عن بياناتك المسموح بها.', { name: m.g }) : tr(m.t)}{m.r === 'e' && <> <Button small onClick={() => ask(m.q)}>{tr("إعادة المحاولة")}</Button></>}
            </div>
          ))}
          {typing && <div className="bub b ty"><Icon name="dots" /> {tr("يكتب…")}</div>}
        </div>
        <div className="cf">
          <input type="text" placeholder={tr("اكتب سؤالك")} aria-label={tr("سؤالك")} value={text} onChange={(e) => { setText(e.target.value); setErr(''); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } }} />
          <Button variant="primary" aria-label={tr("إرسال")} onClick={send}><Icon name="send" /></Button>
        </div>
        {err && <p className="err" role="alert">{err}</p>}
        <Note>{tr("يجيب المساعد وفق صلاحياتك فقط.")}</Note>
      </Card>
    </>
  );
}
