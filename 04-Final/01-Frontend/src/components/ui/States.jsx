import Icon from './Icon.jsx';
import { Button, Card } from './Primitives.jsx';
import { Link } from '../../router/router.jsx';
import { tr } from '../../i18n/index.js';

export function EmptyState({ icon = 'db-off', title, text, action }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export const Skeleton = () => (
  <div aria-busy="true" aria-label={tr('جارٍ التحميل')}>
    <div className="skel" style={{ width: '40%', height: 28 }} />
    <div className="skel" style={{ width: '70%' }} />
    <div className="grid" style={{ margin: '16px 0' }}>
      <div className="skel" style={{ height: 72 }} /><div className="skel" style={{ height: 72 }} /><div className="skel" style={{ height: 72 }} />
    </div>
    <div className="skel" style={{ height: 44 }} /><div className="skel" style={{ height: 44 }} /><div className="skel" style={{ height: 44 }} />
  </div>
);

export const ErrorState = ({ error, onRetry }) => (
  <Card>
    <EmptyState
      icon="unplug"
      title={tr('تعذّر تحميل البيانات')}
      text={tr((error && error.message) || 'حدثت مشكلة أثناء الاتصال. جرّب مرة أخرى.')}
      action={onRetry && <Button variant="primary" onClick={() => onRetry()}>{tr('إعادة المحاولة')}</Button>}
    />
  </Card>
);

export const Forbidden = () => (
  <Card>
    <EmptyState
      icon="lock"
      title={tr('ليس لديك صلاحية للوصول إلى هذه الصفحة')}
      text={tr('تواصل مع المنظّم إذا كنت تعتقد أن هذا خطأ.')}
      action={<Link to="/" className="btn btn-p">{tr('العودة إلى الرئيسية')}</Link>}
    />
  </Card>
);

export const NotFound = () => (
  <Card>
    <EmptyState
      icon="map-off"
      title={tr('الصفحة غير موجودة')}
      text={tr('تحقق من الرابط أو عد إلى الرئيسية.')}
      action={<Link to="/" className="btn btn-p">{tr('العودة إلى الرئيسية')}</Link>}
    />
  </Card>
);

/**
 * Standard loading / error / empty wrapper for a useAsync() state.
 *   <Async state={s} isEmpty={(d)=>d.length===0} empty={<EmptyState .../>}>{(data)=>...}</Async>
 * A 403 from the API shows the Forbidden page, anything else the error state with retry.
 */
export function Async({ state, children, isEmpty, empty }) {
  if (state.error) {
    if (state.error.status === 403) return <Forbidden />;
    return <ErrorState error={state.error} onRetry={() => state.reload()} />;
  }
  if (state.loading && state.data == null) return <Skeleton />;
  if (state.data == null) return null;
  if (isEmpty && isEmpty(state.data)) return <Card>{empty}</Card>;
  return children(state.data);
}
