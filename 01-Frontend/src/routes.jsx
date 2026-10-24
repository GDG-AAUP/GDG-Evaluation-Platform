import Leaderboard from "./pages/Leaderboard.jsx";
import MyPoints from "./pages/MyPoints.jsx";
import Assistant from "./pages/Assistant.jsx";
import ManagerDashboard from "./pages/manager/ManagerDashboard.jsx";
import OrgOverview from "./pages/organizer/OrgOverview.jsx";
import Campuses from "./pages/organizer/Campuses.jsx";
import Members from "./pages/organizer/Members.jsx";
import Managers from "./pages/organizer/Managers.jsx";
import OrgPoints from "./pages/organizer/OrgPoints.jsx";
import Evaluations from "./pages/organizer/Evaluations.jsx";
import Archive from "./pages/organizer/Archive.jsx";
import AuditLog from "./pages/organizer/AuditLog.jsx";
import SystemLog from "./pages/organizer/SystemLog.jsx";
import Policies from "./pages/organizer/Policies.jsx";

import Ratings from "./pages/Ratings.jsx";
import Awards from "./pages/Awards.jsx";
import News from "./pages/News.jsx";

const ALL = ["member", "manager", "organizer"];

// Route table = access rules. Roles not listed get the 403 page (UI guard);
// the API enforces the same rules server-side.
export const ROUTES = [
  { path: "/ratings", roles: ALL, element: Ratings },
  { path: "/organizer/awards", roles: ["organizer"], element: Awards },
  { path: "/organizer/news", roles: ["organizer"], element: News },
  { path: "/leaderboard", roles: ALL, element: Leaderboard },
  { path: "/my-points", roles: ["member"], element: MyPoints },
  { path: "/assistant", roles: ALL, element: Assistant },
  { path: "/manager", roles: ["manager"], element: ManagerDashboard },
  { path: "/manager/team/:id", roles: ["manager"], element: ManagerDashboard },
  { path: "/organizer", roles: ["organizer"], element: OrgOverview },
  { path: "/organizer/campuses", roles: ["organizer"], element: Campuses },
  { path: "/organizer/members", roles: ["organizer"], element: Members },
  { path: "/organizer/managers", roles: ["organizer"], element: Managers },
  { path: "/organizer/points", roles: ["organizer"], element: OrgPoints },
  { path: "/organizer/evals", roles: ["organizer"], element: Evaluations },
  { path: "/organizer/archive", roles: ["organizer"], element: Archive },
  { path: "/organizer/audit", roles: ["organizer"], element: AuditLog },
  { path: "/organizer/syslog", roles: ["organizer"], element: SystemLog },
  { path: "/organizer/policies", roles: ["organizer"], element: Policies },
];
