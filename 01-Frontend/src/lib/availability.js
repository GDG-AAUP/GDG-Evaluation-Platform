// Which pages the REAL backend can serve today (pure functions: no browser/Vite globals, unit-tested).
// With the mock backend (VITE_USE_MOCK=true) every page is available.
//
// When the backend builds the missing endpoints, delete the page's path from COMING_SOON_REAL
// and the page works (see docs/BACKEND_INTEGRATION.md).

export const COMING_SOON_REAL = Object.freeze([
  '/ratings',
  '/activities',
  '/assistant',
  '/manager',
  '/organizer',
  '/organizer/awards',
  '/organizer/news',
  '/organizer/points',
  '/organizer/evals',
  '/organizer/archive',
  '/organizer/syslog',
  '/organizer/policies',
]);

const SET = new Set(COMING_SOON_REAL);

/** True when the page exists in the UI but the real backend has no endpoint for it yet. */
export const isComingSoon = (path, useMock) =>
  !useMock && (SET.has(path) || String(path).startsWith('/manager/team/'));

// Landing page after sign-in with the real backend: a page that works there.
const REAL_HOME = Object.freeze({
  member: '/leaderboard',
  manager: '/leaderboard',
  organizer: '/organizer/members',
});

export const homeFor = (role, useMock, mockHome) => (useMock ? mockHome[role] : REAL_HOME[role] || '/leaderboard');
