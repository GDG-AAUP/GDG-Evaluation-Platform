// Point reversal rules shown in the UI (pure functions, unit-tested). The server enforces the same
// rules in POST /api/points/:id/reverse; these only decide when to offer the "عكس العملية" button.

export const REVERSAL_REASON_MAX = 500;

/**
 * True when `user` may be offered a reversal of `entry` (an entry of the Give Points log).
 * - Only Organizers and Managers reverse points.
 * - A reversal entry is never reversed, and an entry is reversed at most once.
 * - A Manager never reverses points given to themselves. The log already holds only the team's
 *   entries for a Manager (and only the entries an Organizer recorded), so no other scope check
 *   is needed here.
 */
export function canReversePoint(entry, user) {
  if (!entry || !user) return false;
  if (user.role !== 'organizer' && user.role !== 'manager') return false;
  if (entry.isReversal || entry.reversed) return false;
  if (user.role === 'manager' && String(entry.userId) === String(user.id)) return false;
  return true;
}

/** Arabic message for an invalid reason, or '' when the reason is acceptable. */
export function reversalReasonError(reason) {
  const text = String(reason ?? '').trim();
  if (!text) return 'سبب العكس إلزامي.';
  if (text.length > REVERSAL_REASON_MAX) return `سبب العكس طويل جدًا (الحد ${REVERSAL_REASON_MAX} حرف).`;
  return '';
}

/**
 * Confirmation submit: validates the reason, then calls `reverse(entryId, reason)`
 * (pointsApi.reversePoint). Throws an Error with an Arabic message when the reason is invalid.
 */
export async function submitReversal(entry, reason, reverse) {
  const problem = reversalReasonError(reason);
  if (problem) throw new Error(problem);
  return reverse(entry.id, String(reason).trim());
}
