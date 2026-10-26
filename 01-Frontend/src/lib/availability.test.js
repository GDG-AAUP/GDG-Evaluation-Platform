import test from 'node:test';
import assert from 'node:assert/strict';
import { COMING_SOON_REAL, homeFor, isComingSoon } from './availability.js';

test('mock backend: every page is available', () => {
  for (const p of [...COMING_SOON_REAL, '/manager/team/3', '/leaderboard']) assert.equal(isComingSoon(p, true), false, p);
});

test('real backend: pages without endpoints are "coming soon", working pages are not', () => {
  for (const p of ['/ratings', '/activities', '/assistant', '/manager', '/manager/team/3', '/organizer', '/organizer/archive', '/organizer/policies', '/organizer/syslog']) {
    assert.equal(isComingSoon(p, false), true, p);
  }
  for (const p of ['/leaderboard', '/my-points', '/organizer/members', '/organizer/managers', '/organizer/campuses', '/organizer/audit', '/', '/login']) {
    assert.equal(isComingSoon(p, false), false, p);
  }
});

test('landing page after sign-in is always a working page', () => {
  const mockHome = { member: '/leaderboard', manager: '/manager', organizer: '/organizer' };
  assert.equal(homeFor('manager', true, mockHome), '/manager');
  for (const role of ['member', 'manager', 'organizer']) {
    assert.equal(isComingSoon(homeFor(role, false, mockHome), false), false, role);
  }
});
