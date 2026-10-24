// Build-time configuration (Vite env vars; esbuild builds inject the same names).
//   VITE_USE_MOCK=true  -> built-in mock backend (default)
//   VITE_USE_MOCK=false -> real REST API at VITE_API_URL
export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';
export const API_URL = import.meta.env.VITE_API_URL || '/api';
