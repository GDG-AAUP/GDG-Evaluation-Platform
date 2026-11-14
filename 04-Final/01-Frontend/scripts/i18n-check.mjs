// Usage: node scripts/i18n-check.mjs [files...]  (default: all of src)
// Reports tr('...') literals that have no English entry, and Arabic JSX text/attributes not wrapped in tr().
import fs from 'node:fs';
import path from 'node:path';
import { dictionary } from '../src/i18n/index.js';

const AR = /[ء-ي]/;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? walk(p) : [p];
});
const files = (process.argv.length > 2 ? process.argv.slice(2) : walk('src'))
  .filter((f) => /\.(jsx?|mjs)$/.test(f) && !/\.test\.|i18n[\\/]/.test(f));

let missing = 0, unwrapped = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /\btr\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let m;
  while ((m = re.exec(src))) {
    const key = m[2].replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, '\n');
    if (AR.test(key) && !(key in dictionary)) { missing++; console.log(`MISSING  ${f}: ${key}`); }
  }
  src.split('\n').forEach((line, i) => {
    if (!AR.test(line)) return;
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    const stripped = line.replace(/\btr\(\s*(['"`])(?:\\.|(?!\1)[\s\S])*?\1[^)]*\)/g, '');
    if (AR.test(stripped)) { unwrapped++; console.log(`UNWRAPPED ${f}:${i + 1}: ${t.slice(0, 110)}`); }
  });
}
console.log(`\nmissing entries: ${missing}, lines with unwrapped Arabic: ${unwrapped}`);
process.exitCode = missing ? 1 : 0;
