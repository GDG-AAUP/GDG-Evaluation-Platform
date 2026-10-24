// Navigation per role. `icon` is a key of components/ui/Icon.jsx.
//lib/nav.js

const LB = { to: "/leaderboard", icon: "trophy", label: "الترتيب" };
const BOT = { to: "/assistant", icon: "bot", label: "المساعد" };

export const NAV = {
  member: [LB, { to: "/my-points", icon: "star", label: "تقيمي العام" }, BOT],
manager: [
  LB,
  { to: "/manager", icon: "users", label: "فريقي" },
  { to: "/my-points", icon: "star", label: "تقييمي العام" },
  BOT,
],
  organizer: [
    { to: "/organizer", icon: "dashboard", label: "نظرة عامة" },
    { to: "/organizer/campuses", icon: "building", label: "الحرمان والفرق" },
    { to: "/organizer/members", icon: "users", label: "الأعضاء" },
    { to: "/organizer/managers", icon: "manager", label: "المديرون" },
    { to: "/organizer/points", icon: "star", label: "سجل النقاط القديم" },
  
    { to: "/organizer/archive", icon: "archive", label: "الأرشيف الشهري" },
    { to: "/organizer/audit", icon: "history", label: "سجل التدقيق" },
    { to: "/organizer/syslog", icon: "bug", label: "سجل النظام" },
    { to: "/organizer/policies", icon: "sliders", label: "السياسات" },
    LB,
    BOT,
  ],
};

for (const role of Object.keys(NAV))
  NAV[role].unshift(
    { to: "/", icon: "home", label: "صفحة المجتمع" },
    { to: "/ratings", icon: "star", label: "تقييم الأداء" },
{ to: "/activities", icon: "chart", label: "تقييم الأنشطة" },
  );
NAV.organizer.splice(
  2,
  0,
  { to: "/organizer/awards", icon: "trophy", label: "نجوم الشهر" },
  
);

/** Items shown in the mobile bottom bar (the rest go under "More"). */
export function bottomTabs(role) {
  const all = NAV[role];
  if (role !== "organizer")
    return { tabs: all.slice(0, 4), more: all.length > 4 };
  const pick = [
    "/organizer",
    "/organizer/members",
    "/organizer/points",
    "/leaderboard",
  ];
  return { tabs: all.filter((n) => pick.includes(n.to)), more: true };
}
