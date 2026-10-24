import { useId } from 'react';

/** Label + control + inline error. `children` may be a render function receiving the id. */
export function Field({ label, error, hint, children }) {
  const id = useId();
  return (
    <div className="f">
      <label htmlFor={id}>{label}</label>
      {typeof children === 'function' ? children(id) : children}
      {hint && <div className="hint">{hint}</div>}
      {error && <p className="err" role="alert">{error}</p>}
    </div>
  );
}

/** options: [[value,label],...] or [{value,label}] */
export function Select({ options, value, onChange, label, style, id, ...rest }) {
  return (
    <select id={id} value={value ?? ''} aria-label={label} style={style} onChange={(e) => onChange(e.target.value)} {...rest}>
      {options.map((o) => {
        const [v, l] = Array.isArray(o) ? o : [o.value, o.label];
        return <option key={v} value={v}>{l}</option>;
      })}
    </select>
  );
}

export function Segmented({ options, value, onChange, style }) {
  return (
    <div className="seg" role="tablist" style={style}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

export function Chips({ options, value, onChange }) {
  return (
    <div className="chips">
      {options.map(([v, l]) => (
        <button key={v} type="button" className={`chip${value === v ? ' on' : ''}`} aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }) {
  return (
    <label className="sw">
      <input type="checkbox" checked={checked} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export const FilterBar = ({ children }) => <div className="fb">{children}</div>;
