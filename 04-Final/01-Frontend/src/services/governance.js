import { api } from './call.js';
import { backend } from './backend/index.js';
import { RESTRICTED_GOVERNANCE } from '../lib/governance.js';

// Super Admin governance flags (real backend only; the demo has no governance layer).
export const getGovernance = () => api(() => ({ ...RESTRICTED_GOVERNANCE, canEdit: false }), () => backend.governance());
export const setGovernance = (flags, reason) => api(
  () => { throw new Error('governance settings (real backend only)'); },
  () => backend.setGovernance(flags, reason),
);
