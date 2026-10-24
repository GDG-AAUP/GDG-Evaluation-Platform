// esbuild production build.
// Output (dist-single/):
//   index.html + assets/app.js + assets/app.css   -> normal static hosting
//   gdg-evaluation.html                            -> ONE self-contained file (double-click to open)
//
// Env: VITE_USE_MOCK (default "true"), VITE_API_URL (default "/api")
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';

const OUT = 'dist-single';
const env = {
  VITE_USE_MOCK: process.env.VITE_USE_MOCK ?? 'true',
  VITE_API_URL: process.env.VITE_API_URL ?? '/api',
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/assets`, { recursive: true });

await build({
  entryPoints: ['src/main.jsx'],
  bundle: true,
  loader: { '.jpg': 'dataurl', '.png': 'dataurl', '.webp': 'dataurl' },
  minify: true,
  format: 'iife',
  target: 'es2020',
  jsx: 'automatic',
  outfile: `${OUT}/assets/app.js`,
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env.VITE_USE_MOCK': JSON.stringify(env.VITE_USE_MOCK),
    'import.meta.env.VITE_API_URL': JSON.stringify(env.VITE_API_URL),
  },
  logLevel: 'info',
  logOverride: { 'empty-import-meta': 'silent' },
});

const html = readFileSync('index.html', 'utf8');
const js = readFileSync(`${OUT}/assets/app.js`, 'utf8');
const css = readFileSync(`${OUT}/assets/app.css`, 'utf8');
const TAG = '<script type="module" src="/src/main.jsx"></script>';
if (!html.includes(TAG)) throw new Error('index.html entry script tag not found');

// NOTE: function replacers are required: minified code contains "$&" style sequences.
const normal = html
  .replace(TAG, () => '<script src="./assets/app.js" defer></script>')
  .replace('</head>', () => '<link rel="stylesheet" href="./assets/app.css">\n</head>');
writeFileSync(`${OUT}/index.html`, normal);

const safeJs = js.replace(/<\/script/gi, '<\\/script');
const single = html
  .replace(TAG, () => `<script>${safeJs}</script>`)
  .replace('</head>', () => `<style>${css}</style>\n</head>`);
writeFileSync(`${OUT}/gdg-evaluation.html`, single);

console.log(`\nDone. Open ${OUT}/gdg-evaluation.html or serve ${OUT}/`);
