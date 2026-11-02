// Mock-ctx smoke test for the 穷哥们团队 host half.
// Isolated store: DSH_HOME points at a throwaway temp dir.
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const storeRoot = mkdtempSync(join(tmpdir(), 'ai-team-test-'));
process.env.DSH_HOME = storeRoot;

// Seed a v1 store that mirrors the user's pre-upgrade state: flat routes,
// retired qoder/gfmodel, no preset version.
mkdirSync(join(storeRoot, 'ai-team'), { recursive: true });
writeFileSync(join(storeRoot, 'ai-team', 'team.json'), JSON.stringify({
  teamName: 'AI 团队',
  roles: [
    {
      id: 'coder',
      name: '码农',
      provider: 'qoder',
      model: 'gfmodel',
      reasoningEffort: '',
      prompt: '旧码农',
      useWhen: '',
      avoidWhen: '',
      restrictTo: [],
      hardGuard: false,
      enabled: true,
    },
  ],
}, null, 2), 'utf8');

const mod = await import('../index.js');

const calls = { register: [], guard: [], section: [], inject: [] };
let subagentCalls = [];
let dispatchPlan = []; // per-call outcomes for the mocked tools.execute
const mockTools = {
  guard: (g) => { calls.guard.push(g); return () => {}; },
  register: (d) => { calls.register.push(d); return () => {}; },
  execute: async (input) => {
    subagentCalls.push(input);
    const step = dispatchPlan[subagentCalls.length - 1] ?? { ok: true };
    if (step.throw) throw new Error(step.throw);
    return step.result ?? { content: [{ type: 'text', text: '子代理已启动' }] };
  },
};
const mockCtx = {
  tools: mockTools,
  systemPrompt: { section: (s) => { calls.section.push(s); return () => {}; } },
  inject(names, fn) { calls.inject.push(names); },
  effect(fn, label) {
    try { const off = fn(); return typeof off === 'function' ? off : undefined; }
    catch (e) { console.error(`effect threw (${label}):`, e.message); throw e; }
  },
};

await mod.apply(mockCtx);
console.log('apply resolved');
console.log('inject calls:', JSON.stringify(calls.inject));
console.log('guards:', calls.guard.length, 'sections:', calls.section.length, 'tools:', calls.register.map((t) => t.name));

const tool = calls.register[0];

// Flush the async warm-up: execute() awaits loadTeam(), so the preset
// migration is guaranteed complete (and persisted) after this call.
await tool.execute({ role: '__flush__', task: 'x' }, {});

const team = JSON.parse(readFileSync(join(storeRoot, 'ai-team', 'team.json'), 'utf8'));

// --- migration ------------------------------------------------------------
console.log('--- migration ---');
console.log('presetVersion:', team.presetVersion, 'enabled:', team.enabled, 'roles:', team.roles.length);
const coder = team.roles.find((r) => r.id === 'coder');
console.log('coder routes kept + family fallback:', JSON.stringify(coder.routes));
console.log('new presets present:', ['architect', 'writer', 'designer', 'editor', 'reviewer', 'researcher'].every((id) => team.roles.some((r) => r.id === id)));
console.log('flat mirror synced:', coder.provider === coder.routes[0].provider && coder.model === coder.routes[0].model);

// --- dispatch: quota on primary, fallback succeeds -------------------------
console.log('--- fallback chain ---');
subagentCalls = [];
dispatchPlan = [
  { result: { isError: true, content: [{ type: 'text', text: 'quota exceeded for qoder/gfmodel' }] } },
  { result: { content: [{ type: 'text', text: '子代理已启动' }] } },
];
const ok = await tool.execute({ role: '码农', task: '写个脚本' }, {});
console.log('ok:', ok.ok, 'routeIndex:', ok.routeIndex, 'routed:', ok.routed);
console.log('primary call args:', JSON.stringify({ p: subagentCalls[0].arguments.provider, m: subagentCalls[0].arguments.model }));
console.log('fallback call args:', JSON.stringify({ p: subagentCalls[1].arguments.provider, m: subagentCalls[1].arguments.model }));
console.log('detail:', ok.detail.slice(0, 140));

// --- afterRoute continuation ------------------------------------------------
console.log('--- afterRoute ---');
subagentCalls = [];
dispatchPlan = [{ result: { content: [{ type: 'text', text: 'ok' }] } }];
const cont = await tool.execute({ role: '码农', task: '再试', afterRoute: 1 }, {});
console.log('routeIndex:', cont.routeIndex, 'started at candidate 2 (primary skipped):', subagentCalls.length === 1 && subagentCalls[0].arguments.provider === 'workbuddy-global' && subagentCalls[0].arguments.model === 'fast-model');

// --- all candidates fail ----------------------------------------------------
console.log('--- all failed ---');
subagentCalls = [];
dispatchPlan = [
  { result: { isError: true, content: [{ type: 'text', text: 'quota' }] } },
  { throw: 'connection refused' },
];
const allFailed = await tool.execute({ role: '码农', task: 'x' }, {});
console.log('ok:', allFailed.ok);
console.log('detail:', allFailed.detail.replaceAll('\n', ' | ').slice(0, 220));

// --- restricted role still guarded ------------------------------------------
const denied = await tool.execute({ role: '设计师', task: '写首诗', taskKind: 'text' }, {});
console.log('--- hard guard ---');
console.log('deny:', denied.detail.slice(0, 80));

// --- roster -----------------------------------------------------------------
console.log('--- roster ---');
const roster = calls.section[0].text();
console.log('name line:', roster.split('\n')[0]);
console.log('mentions fallback:', roster.includes('候补'));
console.log('coder chain line:', roster.split('\n').find((l) => l.startsWith('### 码农')));

// --- second instance: disabled team -----------------------------------------
console.log('--- disabled team ---');
const store2 = mkdtempSync(join(tmpdir(), 'ai-team-test2-'));
mkdirSync(join(store2, 'ai-team'), { recursive: true });
writeFileSync(join(store2, 'ai-team', 'team.json'), JSON.stringify({ teamName: '穷哥们团队', enabled: false, roles: [], presetVersion: 2 }, null, 2), 'utf8');
process.env.DSH_HOME = store2;
const mod2 = await import('../index.js?disabled');
const calls2 = { register: [], guard: [], section: [] };
await mod2.apply({
  tools: {
    guard: (g) => { calls2.guard.push(g); return () => {}; },
    register: (d) => { calls2.register.push(d); return () => {}; },
    execute: async () => { throw new Error('should not be reached'); },
  },
  systemPrompt: { section: (s) => { calls2.section.push(s); return () => {}; } },
  inject() {},
  effect(fn) { return fn(); },
});
const tool2 = calls2.register[0];
const off = await tool2.execute({ role: '码农', task: 'x' }, {});
console.log('execute while off:', off.detail.slice(0, 60));
console.log('guard reason:', calls2.guard[0]({ name: 'team_dispatch', arguments: { role: '码农', task: 'x' } }));
console.log('roster empty while off:', JSON.stringify(calls2.section[0].text()));
console.log('guard ignores other tools:', calls2.guard[0]({ name: 'bash', arguments: {} }));
console.log('store file still there:', existsSync(join(store2, 'ai-team', 'team.json')));
