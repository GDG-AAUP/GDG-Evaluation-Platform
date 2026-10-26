// esbuild dev server with watch + live reload (alternative to `vite`).
import { context } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const DIR = '.dev';
const PORT = Number(process.env.PORT || 5173);
mkdirSync(DIR, { recursive: true });

const ctx = await context({
  entryPoints: ['src/main.jsx'],
  bundle: true,
  loader: { '.jpg': 'dataurl', '.png': 'dataurl', '.webp': 'dataurl' },
  format: 'iife',
  target: 'es2020',
  jsx: 'automatic',
  sourcemap: true,
  outfile: `${DIR}/app.js`,
  define: {
    'process.env.NODE_ENV': '"development"',
    'import.meta.env.VITE_USE_MOCK': JSON.stringify(process.env.VITE_USE_MOCK ?? 'true'),
    'import.meta.env.VITE_API_URL': JSON.stringify(process.env.VITE_API_URL ?? '/api'),
  },
  logOverride: { 'empty-import-meta': 'silent' },
});

const TAG = '<script type="module" src="/src/main.jsx"></script>';
const html = readFileSync('index.html', 'utf8')
  .replace(TAG, () => `<script>new EventSource('/esbuild').addEventListener('change',()=>location.reload())</script><script src="./app.js" defer></script>`)
  .replace('</head>', () => '<link rel="stylesheet" href="./app.css">\n</head>');
writeFileSync(`${DIR}/index.html`, html);

await ctx.watch();
const { port } = await ctx.serve({ servedir: DIR, port: PORT });
console.log(`Dev server: http://localhost:${port}`);
