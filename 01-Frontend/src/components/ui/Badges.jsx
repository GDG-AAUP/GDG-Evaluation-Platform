import { CAMPUS, ROLE_LABEL } from '../../lib/constants.js';
import { tr } from '../../i18n/index.js';

export const Badge = ({ tone = 'n', children, title }) => <span className={`bd ${tone}`} title={title}>{children}</span>;
export const RoleBadge = ({ role }) => <Badge tone={{ organizer: 'r', manager: 'y', member: 'b' }[role]}>{tr(ROLE_LABEL[role])}</Badge>;
export const CampusBadge = ({ campus }) => <Badge tone={campus === 'jenin' ? 'b' : 'g'}>{tr(CAMPUS[campus])}</Badge>;
export const UserStatusBadge = ({ status }) => (
  status === 'active' ? <Badge tone="g">{tr('نشط')}</Badge> : status === 'disabled' ? <Badge tone="y">{tr('معطّل')}</Badge> : <Badge tone="r">{tr('محذوف')}</Badge>
);
