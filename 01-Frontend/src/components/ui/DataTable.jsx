import { useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import { EmptyState } from './States.jsx';

/**
 * Table with search, sortable columns, pagination, and card layout on mobile
 * (cells carry data-label from the column title).
 *   columns: [{ title, render(row), sort?(row) }]
 */
export default function DataTable({ columns, rows, searchText, pageSize = 10, emptyTitle = 'لا توجد نتائج', rowClass, search = true }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ i: null, dir: 1 });
  const [page, setPage] = useState(0);

  const view = useMemo(() => {
    let r = rows;
    if (q.trim() && searchText) { const s = q.trim().toLowerCase(); r = r.filter((x) => searchText(x).toLowerCase().includes(s)); }
    const col = sort.i != null ? columns[sort.i] : null;
    if (col && col.sort) {
      r = [...r].sort((a, b) => { const x = col.sort(a); const y = col.sort(b); return (x > y ? 1 : x < y ? -1 : 0) * sort.dir; });
    }
    return r;
  }, [rows, q, sort, columns, searchText]);

  const pages = Math.max(1, Math.ceil(view.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const slice = view.slice(cur * pageSize, cur * pageSize + pageSize);

  return (
    <div>
      {search && searchText && (
        <div className="tsearch">
          <Icon name="search" />
          <input type="search" placeholder="بحث" aria-label="بحث في الجدول" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        </div>
      )}
      <div className="tw">
        {!view.length ? (
          <EmptyState icon="db-off" title={emptyTitle} text="جرّب تغيير البحث أو التصفية." />
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  {columns.map((c, i) => (
                    <th
                      key={c.title}
                      className={c.sort ? 'sortable' : undefined}
                      aria-sort={c.sort ? (sort.i === i ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none') : undefined}
                      onClick={c.sort ? () => setSort((s) => ({ i, dir: s.i === i ? -s.dir : 1 })) : undefined}
                    >
                      {c.title}{sort.i === i ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slice.map((r, ri) => (
                  <tr key={r.id ?? ri} className={rowClass ? rowClass(r) : ''}>
                    {columns.map((c) => <td key={c.title} data-label={c.title}>{c.render(r)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {pages > 1 && (
              <div className="pager">
                <button type="button" className="btn sm" disabled={cur === 0} aria-label="السابق" onClick={() => setPage(cur - 1)}><Icon name="chevron-right" /></button>
                <span>{cur + 1} / {pages} ({view.length})</span>
                <button type="button" className="btn sm" disabled={cur >= pages - 1} aria-label="التالي" onClick={() => setPage(cur + 1)}><Icon name="chevron-left" /></button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
