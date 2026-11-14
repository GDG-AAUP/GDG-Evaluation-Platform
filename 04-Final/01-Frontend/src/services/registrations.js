import { api } from './call.js';
import { backend } from './backend/index.js';

// Window event that tells the header badge to refresh its count after a decision.
export const CHANGED_EVENT = 'gdg:registrations-changed';

// Self-registration review (organizer). The demo (mock) mode has no sign-up, so it shows no requests.
export const listPending = () => api(() => [], () => backend.registrations());
export const pendingCount = () => api(() => 0, () => backend.pendingRegistrationCount());
export const approve = (id, b) => api(() => { throw new Error('غير متاح في وضع العرض التجريبي'); }, () => backend.approveRegistration(id, b));
export const reject = (id, reason) => api(() => { throw new Error('غير متاح في وضع العرض التجريبي'); }, () => backend.rejectRegistration(id, reason));
// Sign-up form (signed in at Clerk, no account yet): campus/team options and the request itself.
export const options = () => api(() => ({ campuses: [], teams: [] }), () => backend.registrationOptions());
export const submitRequest = (b) => api(() => { throw new Error('غير متاح في وضع العرض التجريبي'); }, () => backend.submitRegistrationRequest(b));
