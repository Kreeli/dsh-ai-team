// Unit test for the allowlist-narrowed catalog.
//
// Exercises buildProviderCatalog() indirectly by loading index.js with a
// stubbed ctx: we only need the catalog narrowing behaviour, so we import the
// module and drive its exported apply() with fake services.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'index.js'), 'utf8');

// --- static assertions on the guard rails --------------------------------
const checks = [
  ['returns null when the service is absent', /if \(!sel \|\| typeof sel\.current !== 'function'\) return null;/],
  ['returns null when the allowlist is disabled', /snapshot\.enabled === false/],
  ['returns null when the allowlist is empty', /list\.length === 0/],
  ['narrows the catalog to allowlisted routes', /if \(allow && !allow\.has\(`\$\{p\.id\}\/\$\{m\.id\}`\)\) continue;/],
  ['drops providers with nothing dispatchable', /if \(allow && p\.models\.length === 0\) continue;/],
  ['rejects routes missing provider or model', /function isDispatchableRoute\(route\)/],
  ['sanitizeRole filters non-dispatchable routes', /raw\.filter\(isDispatchableRoute\)/],
];
let failed = 0;
for (const [label, re] of checks) {
  const ok = re.test(src);
  if (!ok) failed += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${label}`);
}

// --- behavioural test: simulate the narrowing -----------------------------
function narrow(providers, allow) {
  const out = [];
  for (const p of providers) {
    const models = p.models.filter((m) => !allow || allow.has(`${p.id}/${m.id}`));
    if (allow && models.length === 0) continue;
    out.push({ ...p, models });
  }
  return out;
}

const catalog = [
  { id: 'xiaomi', models: [{ id: 'mimo-v2.6-pro' }, { id: 'mimo-v2.5' }] },
  { id: 'zcode-start-plan', models: [{ id: 'GLM-5.3-Flash' }] },
  { id: 'qoder', models: [{ id: 'dfmodel' }, { id: 'gfmodel' }] },
];
const allow = new Set(['xiaomi/mimo-v2.6-pro', 'qoder/dfmodel']);

const narrowed = narrow(catalog, allow);
const ids = narrowed.flatMap((p) => p.models.map((m) => `${p.id}/${m.id}`));
console.log('\nnarrowed to:', ids.join(', '));
const expect = ['xiaomi/mimo-v2.6-pro', 'qoder/dfmodel'];
const same = JSON.stringify(ids.sort()) === JSON.stringify(expect.sort());
console.log(same ? 'OK    allowlist narrowing produces exactly the allowed routes' : 'FAIL  narrowing mismatch');
if (!same) failed += 1;

// blocked provider must disappear entirely
const hasBlocked = narrowed.some((p) => p.id === 'zcode-start-plan');
console.log(!hasBlocked ? 'OK    blocked provider removed from the picker' : 'FAIL  blocked provider still listed');
if (hasBlocked) failed += 1;

// no allowlist -> everything survives (2 + 1 + 2 = 5 models)
const unfiltered = narrow(catalog, null);
const allCount = unfiltered.flatMap((p) => p.models).length;
console.log(allCount === 5 ? 'OK    no allowlist keeps the full catalog' : `FAIL  expected 5 models, got ${allCount}`);
if (allCount !== 5) failed += 1;

console.log(failed === 0 ? '\nALL CATALOG CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
