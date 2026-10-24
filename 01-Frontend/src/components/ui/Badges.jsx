import { CAMPUS, ROLE_LABEL } from '../../lib/constants.js';

export const Badge = ({ tone = 'n', children, title }) => <span className={`bd ${tone}`} title={title}>{children}</span>;
export const RoleBadge = ({ role }) => <Badge tone={{ organizer: 'r', manager: 'y', member: 'b' }[role]}>{ROLE_LABEL[role]}</Badge>;
export const CampusBadge = ({ campus }) => <Badge tone={campus === 'jenin' ? 'b' : 'g'}>{CAMPUS[campus]}</Badge>;
export const UserStatusBadge = ({ status }) => (
  status === 'active' ? <Badge tone="g">نشط</Badge> : status === 'disabled' ? <Badge tone="y">معطّل</Badge> : <Badge tone="r">محذوف</Badge>
);
