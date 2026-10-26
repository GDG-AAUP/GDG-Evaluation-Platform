import { initials } from '../../lib/format.js';
import Icon from './Icon.jsx';
import { tr } from '../../i18n/index.js';

export const Avatar = ({ name, photo }) => <span className="av">{photo ? <img src={photo} alt={name} /> : initials(name)}</span>;

/** Signed points: green +10 / red −5 (digits kept LTR). */
export const PointsBadge = ({ value }) => (
  <span className={`pts ${value > 0 ? 'pos' : 'neg'}`}><span dir="ltr">{value > 0 ? '+' : '−'}{Math.abs(value)}</span></span>
);

export const Card = ({ children, className = '', style }) => <div className={`card ${className}`.trim()} style={style}>{children}</div>;

export const MetricCard = ({ icon, value, label, tone = '' }) => (
  <div className={`mt ${tone}`}>
    <Icon name={icon} />
    <div><div className="mv">{value}</div><div className="ml">{label}</div></div>
  </div>
);

export const Grid = ({ children, two, style }) => <div className={`grid${two ? ' g2' : ''}`} style={style}>{children}</div>;

export function PageHeader({ title, subtitle, actions, crumb }) {
  return (
    <div className="ph">
      <div className="t">
        {crumb && <div className="crumb">{tr('لوحة المنظّم ‹ {crumb}', { crumb })}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export const Banner = ({ icon = 'info', children }) => <div className="banner b"><Icon name={icon} /> <span>{children}</span></div>;
export const Note = ({ icon = 'info', children }) => <p className="note"><Icon name={icon} /> {children}</p>;

export function Button({ variant, small, full, icon, children, className = '', type = 'button', ...rest }) {
  const cls = ['btn', variant === 'primary' && 'btn-p', variant === 'danger' && 'btn-d', small && 'sm', full && 'full', className].filter(Boolean).join(' ');
  return <button type={type} className={cls} {...rest}>{icon && <Icon name={icon} />}{icon && ' '}{children}</button>;
}

export const IconButton = ({ icon, label, ...rest }) => (
  <button type="button" className="ib" aria-label={label} title={label} {...rest}><Icon name={icon} /></button>
);

export const Spinner = () => <span className="sp2" aria-hidden="true" />;
