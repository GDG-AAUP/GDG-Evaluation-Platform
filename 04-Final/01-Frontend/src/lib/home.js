import { USE_MOCK } from '../config.js';
import { homeFor as pick } from './availability.js';
import { HOME_BY_ROLE } from './constants.js';

/** Landing page of a role (a working page when the real backend is used). */
export const homeFor = (role) => pick(role, USE_MOCK, HOME_BY_ROLE);
