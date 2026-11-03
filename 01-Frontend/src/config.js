// Build-time configuration (Vite env vars; esbuild builds inject the same names).
//   VITE_USE_MOCK=true  -> built-in mock backend (default)
//   VITE_USE_MOCK=false -> real REST API at VITE_API_URL
export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';
export const API_URL = import.meta.env.VITE_API_URL || '/api';
// Clerk publishable key (public, safe in the browser). Needed only when VITE_USE_MOCK=false.
// Never put the Clerk SECRET key (sk_...) in the frontend.
export const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '';
