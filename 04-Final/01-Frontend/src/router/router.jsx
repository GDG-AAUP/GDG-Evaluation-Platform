import { useEffect, useState } from 'react';

// Minimal hash router (no dependency): "#/organizer/members?x=1" -> path "/organizer/members".

const readPath = () => (window.location.hash.slice(1) || '/').split('?')[0];

export function usePath() {
  const [path, setPath] = useState(readPath);
  useEffect(() => {
    const on = () => setPath(readPath());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return path;
}

export function navigate(to, { replace = false } = {}) {
  if (replace) window.location.replace(`#${to}`);
  else window.location.hash = `#${to}`;
}

export function Link({ to, className, children, ...rest }) {
  return <a href={`#${to}`} className={className} {...rest}>{children}</a>;
}

/** Matches "/manager/team/:id" style patterns. Returns params or null. */
export function matchPath(pattern, path) {
  const a = pattern.split('/');
  const b = path.split('/');
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i += 1) {
    if (a[i][0] === ':') params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}
