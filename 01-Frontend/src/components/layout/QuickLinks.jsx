import { useState } from 'react';
import { QUICK_LINKS } from '../../links.config.js';
import Icon from '../ui/Icon.jsx';
import { MessageDialog } from '../ui/Dialog.jsx';
import { tr } from '../../i18n/index.js';

export const linksFor = (role) => QUICK_LINKS.filter((l) => !l.roles || l.roles.includes(role));

/** Renders the quick links as <a> (new tab). A link without URL explains how to set it. */
export default function QuickLinks({ role, onPick, className }) {
  const [missing, setMissing] = useState(null);
  const items = linksFor(role);
  if (!items.length) return null;
  return (
    <>
      {items.map((l) => (l.url ? (
        <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer" className={className} onClick={onPick}>
          <Icon name={l.icon} /><span>{tr(l.label)}</span><Icon name="external" className="ext" />
        </a>
      ) : (
        <a key={l.id} href="#/" className={className} onClick={(e) => { e.preventDefault(); setMissing(l); if (onPick) onPick(); }}>
          <Icon name={l.icon} /><span>{tr(l.label)}</span>
        </a>
      )))}
      {missing && (
        <MessageDialog title={tr(missing.label)} onClose={() => setMissing(null)}>
          {tr('لم يُضبط رابط «{label}» بعد. أضِف الرابط في الملف', { label: tr(missing.label) })} <code dir="ltr">src/links.config.js</code>.
        </MessageDialog>
      )}
    </>
  );
}
