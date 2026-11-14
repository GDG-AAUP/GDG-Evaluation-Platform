// GDG mark (‹ › in the four Google colors), redrawn as a vector from the supplied logo.
// It has NO background, so it sits correctly on both the light and the dark theme.
export default function Logo({ size = 34 }) {
  const h = size;
  const w = Math.round((size * 258) / 132);
  return (
    <svg width={w} height={h} viewBox="0 0 258 132" role="img" aria-label="GDG" style={{ background: 'none' }}>
      <g fill="none" strokeWidth="38" strokeLinecap="round" strokeLinejoin="round">
        <path d="M40 52 95 19" stroke="#EA4335" />
        <path d="M24 64 89 110" stroke="#4285F4" />
        <path d="M161 115 222 80" stroke="#FBBC04" />
        <path d="M161 20 240 73" stroke="#34A853" />
      </g>
    </svg>
  );
}

export const ColorBar = () => <div className="bar4"><i /><i /><i /><i /></div>;
