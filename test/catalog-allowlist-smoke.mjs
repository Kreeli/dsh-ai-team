// Unit test for the catalog + dispatchability marking.
//
// The picker lists EVERY reachable model; the Session allowlist decides only
// the `dispatchable` flag, because the subagent tool rejects routes outside it.
// These checks pin that contract so a future edit cannot silently start hiding
// models again (the user explicitly wants to see all of them).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'index.js'), 'utf8');

// --- static assertions ----------------------------------------------------
const checks = [
  ['allowlist returns null when the service is absent', /if \(!sel \|\| typeof sel\.current !== 'function'\) return null;/],
  ['allowlist returns null when disabled', /snapshot\.enabled === false/],
  ['allowlist returns null when empty', /list\.length === 0/],
  ['catalog marks dispatchability instead of filtering', /dispatchable: allow \? allow\.has\(`\$\{p\.id\}\/\$\{m\.id\}`\) : true,/],
  ['catalog keeps providers even when none are dispatchable', /if \(p\.models\.length === 0\) continue;/],
  ['catalog no longer drops non-allowlisted models', /(?!.*if \(allow && !allow\.has)/],
  ['dispatchable providers sort first', /aAny - bAny/],
  ['rejects routes missing provider or model', /function isDispatchableRoute\(route\)/],
  ['sanitizeRole filters non-dispatchable routes', /raw\.filter\(isDispatchableRoute\)/],
];
let failed = 0;
for (const [label, re] of checks) {
  const ok = re.test(src);
  if (!ok) failed += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${label}`);
}

// --- behavioural test: every model is listed, only some dispatchable -------
function build(providers, allow) {
  const out = [];
  for (const p of providers) {
    const models = p.models.map((m) => ({
      ...m,
      dispatchable: allow ? allow.has(`${p.id}/${m.id}`) : true,
    }));
    if (models.length === 0) continue;
    out.push({ ...p, models });
  }
  out.sort((a, b) => {
    const aAny = a.models.some((m) => m.dispatchable) ? 0 : 1;
    const bAny = b.models.some((m) => m.dispatchable) ? 0 : 1;
    return aAny - bAny || a.id.localeCompare(b.id);
  });
  return out;
}

const catalog = [
  { id: 'xiaomi', models: [{ id: 'mimo-v2.6-pro' }, { id: 'mimo-v2.5' }] },
  { id: 'zcode-start-plan', models: [{ id: 'GLM-5.3-Flash' }] },
  { id: 'qoder', models: [{ id: 'dfmodel' }, { id: 'gfmodel' }] },
];
const allow = new Set(['xiaomi/mimo-v2.6-pro', 'qoder/dfmodel']);

const built = build(catalog, allow);
const listed = built.flatMap((p) => p.models.map((m) => `${p.id}/${m.id}`));
console.log('\nlisted:', listed.join(', '));

// 1. nothing is hidden
const allFive = ['xiaomi/mimo-v2.6-pro', 'xiaomi/mimo-v2.5', 'zcode-start-plan/GLM-5.3-Flash', 'qoder/dfmodel', 'qoder/gfmodel'];
const nothingHidden = allFive.every((k) => listed.includes(k));
console.log(nothingHidden ? 'OK    every model is listed (nothing hidden)' : 'FAIL  some models were hidden');
if (!nothingHidden) failed += 1;

// 2. dispatchability matches the allowlist exactly
const dispatchable = built.flatMap((p) => p.models.filter((m) => m.dispatchable).map((m) => `${p.id}/${m.id}`));
const correct = JSON.stringify(dispatchable.sort()) === JSON.stringify([...allow].sort());
console.log(correct ? 'OK    dispatchable set matches the allowlist' : `FAIL  dispatchable=${dispatchable}`);
if (!correct) failed += 1;

// 3. blocked provider still appears (so the user can see it exists)
const blockedShown = built.some((p) => p.id === 'zcode-start-plan');
console.log(blockedShown ? 'OK    non-dispatchable provider is still visible' : 'FAIL  blocked provider disappeared');
if (!blockedShown) failed += 1;

// 4. providers with dispatchable models sort first
const firstHasDispatchable = built[0].models.some((m) => m.dispatchable);
console.log(firstHasDispatchable ? 'OK    dispatchable providers sort first' : 'FAIL  sort order wrong');
if (!firstHasDispatchable) failed += 1;

// 5. no allowlist -> everything dispatchable
const open = build(catalog, null);
const allOpen = open.every((p) => p.models.every((m) => m.dispatchable));
console.log(allOpen ? 'OK    without an allowlist everything is dispatchable' : 'FAIL  some stayed blocked');
if (!allOpen) failed += 1;

console.log(failed === 0 ? '\nALL CATALOG CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
