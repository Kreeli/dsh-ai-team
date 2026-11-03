/**
 * 穷哥们团队 (AI Team Studio) — Host half.
 *
 * Owns:
 *  - the team store (~/.zcode/ai-team/team.json by default), written by the
 *    Client settings card through a loopback-only web route;
 *  - the `team_dispatch` agent tool: resolves a role to its ROUTE CHAIN
 *    (primary + fallbacks) and dispatches through the core `subagent` tool,
 *    walking to the next candidate when one fails (quota, dead model, ...);
 *  - a system-prompt section (the team roster) teaching the main model which
 *    roles exist, their soft constraints, and the retry protocol;
 *  - a monotonic guard that denies dispatches violating a role's task-kind
 *    restriction (硬约束) and while the team is switched off.
 *
 * Plain JS, no zcode package imports: every registry is feature-detected and
 * degrades loudly instead of failing activation.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PLUGIN_NAME = '@local/dsh-ai-team';
const ROUTE_PATH = '/ai-team/api';
const TOOL_NAME = 'team_dispatch';
const REFUSAL = 'request refused: this route answers same-origin loopback only';
const PRESET_VERSION = 2;

/** Fallback catalog for hosts without the llm service (headless profiles).
 *  Shape matches the live catalog: { id, name, models: [{id, name}] }. */
const FALLBACK_PROVIDERS = [
  { id: 'xiaomi', name: 'xiaomi', models: [
    { id: 'mimo-v2.6-flash', name: 'MiMo-V2.6-Flash' },
    { id: 'mimo-v2.6-pro', name: 'MiMo-V2.6-Pro' },
  ] },
  { id: 'workbuddy-global', name: 'WorkBuddy Global', models: [
    { id: 'deepseek-v4.1-flash-sg', name: 'DeepSeek-V4.1-Flash' },
    { id: 'gpt-6-luna', name: 'GPT-6-Luna' },
    { id: 'kimi-k3.1-pro', name: 'Kimi-K3.1-Pro' },
  ] },
  { id: 'qoder', name: 'Qoder', models: [
    { id: 'dmodel', name: 'DeepSeek-V4-Pro' },
    { id: 'dfmodel', name: 'DeepSeek-Flash' },
  ] },
];

/** Each role carries a ROUTE CHAIN: candidates tried in order; the first
 *  that dispatches cleanly wins. Defaults reference routes observed live on
 *  2026-11-03; every role gets a cross-provider fallback so a dead model or
 *  an exhausted quota never takes the whole role down. */
const DEFAULT_TEAM = {
  teamName: '穷哥们团队',
  enabled: true,
  roles: [
    {
      id: 'architect',
      name: '架构师',
      routes: [
        { provider: 'workbuddy-global', model: 'deepseek-v4.1-flash-sg', reasoningEffort: '' },
        { provider: 'workbuddy-global', model: 'glm-5.3-flash', reasoningEffort: '' },
      ],
      prompt: '你是穷哥们团队的架构师。收到任务后输出：结构化方案、关键技术决策及理由、风险清单、可执行的任务拆解。不写与决策无关的长篇代码。',
      useWhen: '方案设计、技术选型、任务拆解、方案评审、疑难问题分析',
      avoidWhen: '图像/网页视觉相关任务、长文写作',
      restrictTo: [],
      hardGuard: false,
      enabled: true,
    },
    {
      id: 'coder',
      name: '码农',
      routes: [
        { provider: 'workbuddy-global', model: 'glm-5.3-flash', reasoningEffort: '' },
        { provider: 'qoder', model: 'dfmodel', reasoningEffort: '' },
      ],
      prompt: '你是穷哥们团队的实现工程师。直接给出可运行的代码：完整文件或精确补丁，附最小说明。遵循调用方提供的项目约定。',
      useWhen: '写代码、修 bug、重构、写脚本、代码实现类子任务',
      avoidWhen: '需求还没定就先要方案的任务（先交给架构师）',
      restrictTo: [],
      hardGuard: false,
      enabled: true,
    },
    {
      id: 'writer',
      name: '笔杆子',
      routes: [
        { provider: 'workbuddy-global', model: 'kimi-k3.1-pro', reasoningEffort: '' },
        { provider: 'workbuddy-global', model: 'gpt-6-luna', reasoningEffort: '' },
      ],
      prompt: '你是穷哥们团队的写作者。产出结构清晰、语气贴合调用方要求的成稿：文档、公告、长文、润色与翻译。不改代码。',
      useWhen: '长文写作、文案、文档、润色、翻译、总结',
      avoidWhen: '代码实现、图像相关任务',
      restrictTo: [],
      hardGuard: false,
      enabled: true,
    },
    {
      id: 'designer',
      name: '设计师',
      routes: [
        { provider: 'xiaomi', model: 'mimo-v2.6-pro', reasoningEffort: '' },
        { provider: 'xiaomi', model: 'mimo-v2.6-flash', reasoningEffort: '' },
      ],
      prompt: '你是穷哥们团队的视觉设计师，只处理图像生成、网页/界面设计与多模态理解。输出设计稿、HTML/CSS 视觉方案或图像理解结论。',
      useWhen: '生图、网站与 UI 设计、图像/截图理解（多模态）',
      avoidWhen: '纯文本任务（写作、规划、写代码）',
      restrictTo: ['image', 'design', 'multimodal'],
      hardGuard: true,
      enabled: true,
    },
    {
      id: 'editor',
      name: '剪辑师',
      routes: [
        { provider: 'qoder', model: 'dfmodel', reasoningEffort: '' },
        { provider: 'workbuddy-global', model: 'fast-model', reasoningEffort: '' },
      ],
      prompt: '你是穷哥们团队的剪辑师，负责视频剪辑的策划与自动化：分镜脚本、时间轴、FFmpeg/剪映命令、字幕与转场清单、B-roll 建议。给可直接执行的命令与参数。',
      useWhen: '剪辑方案、FFmpeg/剪映脚本、字幕时间轴、视频结构规划、转场与配乐建议',
      avoidWhen: '生图、界面设计、纯代码工程',
      restrictTo: [],
      hardGuard: false,
      enabled: true,
    },
    {
      id: 'reviewer',
      name: '代码审查员',
      routes: [
        { provider: 'workbuddy-global', model: 'deepseek-v4.1-flash-sg', reasoningEffort: '' },
        { provider: 'qoder', model: 'dmodel', reasoningEffort: '' },
      ],
      prompt: '你是穷哥们团队的代码审查员。只审不改：按严重度分级输出（必须修 / 建议 / Nit），覆盖缺陷、边界条件、并发、安全与可读性；每条给依据与最小修复思路。',
      useWhen: '代码评审、diff 审查、安全排查、重构建议评估',
      avoidWhen: '直接动手改代码（那是码农的事）、图像任务',
      restrictTo: [],
      hardGuard: false,
      enabled: true,
    },
    {
      id: 'researcher',
      name: '资料调研员',
      routes: [
        { provider: 'workbuddy-global', model: 'gpt-6-luna', reasoningEffort: '' },
        { provider: 'qoder', model: 'dfmodel', reasoningEffort: '' },
      ],
      prompt: '你是穷哥们团队的资料调研员。快速查证并汇总：结论先行、来源可溯、区分事实与推断、标注不确定度；需要外部信息时明确说明哪些待查证。',
      useWhen: '资料查询、技术调研、多方案对比、背景汇总',
      avoidWhen: '写正式成稿（交给笔杆子）、代码实现',
      restrictTo: [],
      hardGuard: false,
      enabled: true,
    },
  ],
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function storeDir() {
  const base = process.env.DSH_HOME || process.env.DSH_PROFILE_DIR || join(homedir(), '.dsh');
  return join(base, 'ai-team');
}

function storePath() {
  return join(storeDir(), 'team.json');
}

function sanitizeRoute(r) {
  return {
    provider: String(r?.provider ?? '').trim(),
    model: String(r?.model ?? '').trim(),
    reasoningEffort: String(r?.reasoningEffort ?? '').trim(),
  };
}

/**
 * A route with no provider/model does NOT mean "inherit the default" — the
 * dispatch path only forwards provider/model when both are set, so such a
 * route silently runs the child on the session's default model. That is
 * exactly the surprise this guard removes: incomplete routes are dropped
 * instead of being persisted.
 */
function isDispatchableRoute(route) {
  return Boolean(route && route.provider && route.model);
}

function sanitizeRole(r) {
  const raw = Array.isArray(r?.routes) && r.routes.length > 0
    ? r.routes.map(sanitizeRoute)
    : (r?.provider || r?.model
      ? [sanitizeRoute(r)]
      : []);
  const routes = raw.filter(isDispatchableRoute);
  const primary = routes[0] ?? { provider: '', model: '', reasoningEffort: '' };
  return {
    id: String(r?.id ?? '').trim() || `role-${Math.random().toString(36).slice(2, 8)}`,
    name: String(r?.name ?? r?.id ?? '未命名角色').trim() || '未命名角色',
    routes,
    // flat mirror of the primary route, kept for anything reading old fields
    provider: primary.provider,
    model: primary.model,
    reasoningEffort: primary.reasoningEffort,
    prompt: String(r?.prompt ?? ''),
    useWhen: String(r?.useWhen ?? ''),
    avoidWhen: String(r?.avoidWhen ?? ''),
    restrictTo: Array.isArray(r?.restrictTo) ? r.restrictTo.map((k) => String(k).trim()).filter(Boolean) : [],
    hardGuard: r?.hardGuard === true,
    enabled: r?.enabled !== false,
  };
}

function sanitizeTeam(raw) {
  const team = raw && typeof raw === 'object' ? raw : {};
  const roles = Array.isArray(team.roles) ? team.roles.filter((r) => r && typeof r === 'object') : null;
  return {
    teamName: typeof team.teamName === 'string' && team.teamName.trim() ? team.teamName.trim() : DEFAULT_TEAM.teamName,
    enabled: team.enabled !== false,
    roles: roles ? roles.map(sanitizeRole) : structuredClone(DEFAULT_TEAM.roles),
    presetVersion: Number.isFinite(team.presetVersion) ? team.presetVersion : 0,
  };
}

/** A live same-family fallback for a route whose model may have retired. */
function familyFallback(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('mimo')) return { provider: 'xiaomi', model: 'mimo-v2.6-pro', reasoningEffort: '' };
  if (m.includes('glm')) return { provider: 'workbuddy-global', model: 'glm-5.3-flash', reasoningEffort: '' };
  if (m.includes('deepseek')) return { provider: 'workbuddy-global', model: 'deepseek-v4.1-flash-sg', reasoningEffort: '' };
  if (m.includes('kimi')) return { provider: 'workbuddy-global', model: 'kimi-k3.1-pro', reasoningEffort: '' };
  if (m.includes('gpt')) return { provider: 'workbuddy-global', model: 'gpt-6-luna', reasoningEffort: '' };
  return { provider: 'workbuddy-global', model: 'fast-model', reasoningEffort: '' };
}

let storeCache = null;

async function loadTeam() {
  if (storeCache) return storeCache;
  let raw = null;
  try {
    if (existsSync(storePath())) {
      raw = JSON.parse(await readFile(storePath(), 'utf8'));
    }
  } catch (error) {
    console.error(`[${PLUGIN_NAME}] team store unreadable, using defaults: ${error?.message ?? error}`);
  }
  const team = sanitizeTeam(raw);

  // One-time preset upgrade: append roles introduced by newer presets and
  // give single-route roles a live same-family fallback, so a retired model
  // (e.g. qoder/gfmodel) degrades to a working candidate automatically.
  if ((raw?.presetVersion ?? 0) < PRESET_VERSION) {
    const have = new Set(team.roles.map((r) => r.id));
    for (const preset of DEFAULT_TEAM.roles) {
      if (!have.has(preset.id)) team.roles.push(structuredClone(preset));
    }
    for (const role of team.roles) {
      if (role.routes.length === 1) {
        const fb = familyFallback(role.routes[0].model);
        if (fb && !(role.routes[0].provider === fb.provider && role.routes[0].model === fb.model)) {
          role.routes.push(fb);
        }
      }
    }
    team.presetVersion = PRESET_VERSION;
    storeCache = team;
    try {
      await mkdir(storeDir(), { recursive: true });
      await writeFile(storePath(), JSON.stringify(team, null, 2), 'utf8');
    } catch (error) {
      console.error(`[${PLUGIN_NAME}] preset upgrade persist failed: ${error?.message ?? error}`);
    }
    return team;
  }

  storeCache = team;
  return team;
}

async function saveTeam(next) {
  const team = sanitizeTeam(next);
  team.presetVersion = PRESET_VERSION; // client saves are always current-shape
  await mkdir(storeDir(), { recursive: true });
  await writeFile(storePath(), JSON.stringify(team, null, 2), 'utf8');
  storeCache = team;
  return team;
}

// ---------------------------------------------------------------------------
// Roster (soft constraints, injected into every agent's prompt)
// ---------------------------------------------------------------------------

function routeText(route) {
  const pair = [route?.provider, route?.model].filter(Boolean).join('/');
  return pair || '(继承默认路由)';
}

function rosterText(team) {
  if (team.enabled === false) return '';
  const enabled = team.roles.filter((r) => r.enabled);
  if (enabled.length === 0) return '';
  const lines = [
    `## 穷哥们团队（${team.teamName}）`,
    '',
    '你拥有一支由 `team_dispatch` 工具调度的子代理团队：每个成员在独立上下文中用各自配置的模型路由执行子任务，适合把专业子工作外包出去，不占用当前对话上下文。用成员名字或 id 作为 `role` 参数。',
    '成员带路由候补链：主路由失败（额度不足、模型下线等）会自动切到下一条候补。若某成员执行后回报额度/失败，重试时传 `afterRoute` = 上次失败的路由序号（从 1 开始），本次将从其下一条候补继续。',
    '未标注「仅限」的成员可自由调度；标注了「仅限任务类别」的成员，调用时必须传对应的 `taskKind`。',
    '',
  ];
  for (const role of enabled) {
    const chain = role.routes.map(routeText).join(' → ');
    lines.push(`### ${role.name}（${role.id}）→ ${chain}`);
    if (role.prompt) lines.push(`职责：${role.prompt}`);
    if (role.useWhen) lines.push(`适用：${role.useWhen}`);
    if (role.avoidWhen) lines.push(`避免：${role.avoidWhen}`);
    if (role.restrictTo.length > 0) {
      lines.push(`仅限任务类别：${role.restrictTo.join('、')}（调用时 taskKind 必须是其中之一${role.hardGuard ? '，硬约束，传错会被拒绝' : ''}）`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Dispatch validation (shared by guard and execute — one set of rules)
// ---------------------------------------------------------------------------

function validateDispatch(team, args) {
  const roleKey = String(args?.role ?? '').trim();
  const task = String(args?.task ?? '').trim();
  if (!roleKey) return { ok: false, reason: 'team_dispatch 缺少 role：请传成员名字或 id' };
  if (!task) return { ok: false, reason: 'team_dispatch 缺少 task：请把要委派的子任务完整写出来' };
  const role = team.roles.find((r) => r.enabled && (r.id === roleKey || r.name === roleKey));
  if (!role) {
    const known = team.roles.filter((r) => r.enabled).map((r) => `${r.name}(${r.id})`).join('、') || '(无启用角色)';
    return { ok: false, reason: `没有启用中的成员「${roleKey}」。当前可用：${known}` };
  }
  if (role.restrictTo.length > 0) {
    const kinds = role.restrictTo;
    const kind = String(args?.taskKind ?? '').trim();
    if (!kind || !kinds.includes(kind)) {
      return { ok: false, reason: `成员「${role.name}」仅限任务类别 ${kinds.join('、')}。请传 taskKind 为其中之一；若任务不属于这些类别，请改派其他成员或自己完成。` };
    }
  }
  return { ok: true, role, task };
}

function composeChildPrompt(role, task, context, teamName, taskKind) {
  const parts = [];
  if (role.prompt) parts.push(role.prompt);
  const kind = String(taskKind ?? '').trim();
  parts.push(`---\n来自「${teamName}」的委派任务${kind ? `（taskKind: ${kind}）` : ''}：\n${task}`);
  const ctx = String(context ?? '').trim();
  if (ctx) parts.push(`---\n相关上下文（你可能看不到发起方的对话历史，以下是需要的一切）：\n${ctx}`);
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Tool definition shape: prefer the dsh defineTool (flat parameters), fall
// back to a plain JSON-Schema object — the two parameter shapes differ; never
// hand JSON Schema to defineTool.
// ---------------------------------------------------------------------------

let defineToolCache;
async function loadDefineTool() {
  if (defineToolCache !== undefined) return defineToolCache;
  try {
    const m = await import('@deepseek-ai/dsh-tools');
    defineToolCache = typeof m?.defineTool === 'function' ? m.defineTool : null;
  } catch {
    defineToolCache = null;
  }
  return defineToolCache;
}

function flatParamsToJsonSchema(params) {
  const properties = {};
  const required = [];
  for (const [name, spec] of Object.entries(params || {})) {
    const { required: req, ...rest } = spec || {};
    properties[name] = rest;
    if (req) required.push(name);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

function shapeTool(def, defineTool) {
  if (defineTool) return defineTool(def);
  return { ...def, parameters: flatParamsToJsonSchema(def.parameters) };
}

// ---------------------------------------------------------------------------
// Web route (settings card transport, loopback-only like every other
// host-owned config route)
// ---------------------------------------------------------------------------

function isTrustedRequest(req) {
  const remote = req?.socket?.remoteAddress ?? '';
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote);
  if (!loopback) return false;
  const origin = req.headers?.origin;
  return origin === undefined || origin === '';
}

// Live service references filled by scoped injects in apply(); read by the
// API route. Empty until the services activate — the route then serves the
// fallback catalog.
const serviceRefs = { webServer: null, llm: null, subagents: null, modelSelection: null };

/**
 * Read the exact provider/model routes this Session may delegate to.
 *
 * The subagent tool enforces `allowedModels`; anything outside it fails at
 * dispatch time. Surfacing the full llm catalog in the picker would let the
 * user choose routes that can never work, so the catalog is narrowed to this
 * allowlist whenever the host exposes one.
 *
 * Returns null when the host gives us no allowlist — then the full catalog
 * stands (nothing is being filtered anyway).
 */
function allowedRouteKeys() {
  const sel = serviceRefs.modelSelection;
  if (!sel || typeof sel.current !== 'function') return null;
  let snapshot;
  try {
    snapshot = sel.current();
  } catch {
    return null;
  }
  if (!snapshot || snapshot.enabled === false) return null;
  const list = Array.isArray(snapshot.allowedModels) ? snapshot.allowedModels : [];
  if (list.length === 0) return null;
  const keys = new Set();
  for (const entry of list) {
    const provider = String(entry?.provider ?? '').trim();
    const model = String(entry?.model ?? '').trim();
    if (provider && model) keys.add(`${provider}/${model}`);
  }
  return keys.size > 0 ? keys : null;
}

function currentCatalog() {
  const llm = serviceRefs.llm;
  if (!llm || typeof llm.listModels !== 'function') return Promise.resolve(FALLBACK_PROVIDERS);
  return buildProviderCatalog(llm);
}

/**
 * Build the provider/model catalog from the SAME source the composer's
 * model selector uses: the llm registry (configurable providers from the
 * settings directory + registered adapters), models listed per provider.
 *
 * When the Session carries a subagent allowlist, the catalog is narrowed to
 * it so every option in the card is dispatchable.
 */
async function buildProviderCatalog(llm) {
  const allow = allowedRouteKeys();
  const providers = new Map();
  const add = (id, name) => {
    if (typeof id !== 'string' || id === '') return;
    const existing = providers.get(id);
    if (!existing) providers.set(id, { id, name: name || id, models: [] });
    else if (name && existing.name === id) existing.name = name;
  };
  try {
    for (const p of llm.listConfigurableProviders?.() ?? []) add(p?.provider, p?.displayName);
  } catch { /* registry shape drift: adapters below still count */ }
  try {
    for (const p of llm.listProviders?.() ?? []) add(p?.id, p?.name);
  } catch { /* same */ }
  const out = [];
  for (const p of providers.values()) {
    let models = [];
    try {
      models = (await llm.listModels(p.id)) ?? [];
    } catch {
      p.unavailable = true; // credentials missing or adapter not ready
    }
    const seen = new Set();
    p.models = [];
    for (const m of models) {
      if (!m || typeof m.id !== 'string' || seen.has(m.id)) continue;
      if (allow && !allow.has(`${p.id}/${m.id}`)) continue;
      seen.add(m.id);
      p.models.push({ id: m.id, name: (typeof m.name === 'string' && m.name) || m.id });
    }
    // A provider with nothing dispatchable is noise in the picker.
    if (allow && p.models.length === 0) continue;
    out.push({
      id: p.id,
      name: p.name,
      models: p.models,
      ...(p.unavailable ? { unavailable: true } : {}),
    });
  }
  return out;
}

function registerApiRoute() {
  return serviceRefs.webServer.register({
    name: 'ai-team-api',
    kind: 'exact',
    path: ROUTE_PATH,
    handler: async (req, res) => {
      const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(body));
      };
      if (!isTrustedRequest(req)) {
        send(403, { error: REFUSAL });
        return;
      }
      if (req.method === 'GET') {
        const team = await loadTeam();
        send(200, { teamName: team.teamName, enabled: team.enabled, roles: team.roles, providers: await currentCatalog() });
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }
      try {
        const chunks = [];
        let total = 0;
        for await (const chunk of req) {
          total += chunk.length;
          if (total > 256 * 1024) {
            send(413, { error: 'payload too large' });
            req.destroy();
            return;
          }
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (body?.reset === true) {
          await saveTeam(DEFAULT_TEAM);
          send(200, { teamName: storeCache.teamName, enabled: storeCache.enabled, roles: storeCache.roles, providers: await currentCatalog() });
          return;
        }
        // Master-switch toggle travels alone, without roles: it must never
        // commit whatever unsaved edits the card happens to hold.
        if (typeof body?.enabled === 'boolean' && body?.roles === undefined && body?.teamName === undefined) {
          const team = await loadTeam();
          team.enabled = body.enabled;
          const saved = await saveTeam(team);
          send(200, { teamName: saved.teamName, enabled: saved.enabled, roles: saved.roles, providers: await currentCatalog() });
          return;
        }
        const team = await saveTeam(body ?? {});
        send(200, { teamName: team.teamName, enabled: team.enabled, roles: team.roles, providers: await currentCatalog() });
      } catch (error) {
        send(400, { error: String(error?.message ?? error) });
      }
    },
  });
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

// Hard injects: `tools` and `systemPrompt` are core services of every dsh
// composition; cordis refuses property access without this declaration.
// Everything else rides scoped ctx.inject below.
export const inject = ['tools', 'systemPrompt'];

export async function apply(ctx) {
  // 1. Settings-card API route. webServer/llm exist only under their own
  //    profiles: scoped injects keep other profiles untouched.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (scope) => {
      try {
        serviceRefs.webServer = scope.webServer;
        registerApiRoute();
      } catch (error) {
        console.error(`[${PLUGIN_NAME}] settings route skipped: ${error?.message ?? error}`);
      }
    });
    ctx.inject(['llm'], (scope) => { serviceRefs.llm = scope.llm; });
    // Optional: the Session's subagent allowlist. Absent on older hosts, in
    // which case the picker simply shows the whole catalog (unfiltered).
    ctx.inject(['subagentModelSelection'], (scope) => {
      serviceRefs.modelSelection = scope.subagentModelSelection ?? null;
    });
  }

  // 2. Dispatch guard (hard constraints + master switch). Synchronous.
  const tools = ctx.tools;
  if (tools && typeof tools.guard === 'function') {
    ctx.effect(() => tools.guard((exec) => {
      if (exec?.name !== TOOL_NAME) return undefined;
      const team = storeCache;
      if (!team) return undefined;
      if (team.enabled === false) return '穷哥们团队当前已关闭（总开关）。请直接自己完成该任务，或提示用户在「穷哥们团队」卡片中重新开启。';
      const args = exec.arguments ?? exec.args ?? {};
      const verdict = validateDispatch(team, args);
      return verdict.ok ? undefined : `team_dispatch 被硬约束拦截：${verdict.reason}`;
    }), 'ai-team: dispatch guard');
  }

  // 3. The dispatch tool itself.
  if (tools && typeof tools.register === 'function') {
    const teamNameOf = () => storeCache?.teamName ?? '穷哥们团队';
    const definition = {
      name: TOOL_NAME,
      description:
        '把一个自包含的子任务委派给穷哥们团队成员（独立上下文的子代理，按该成员的路由链执行）。' +
        '先看系统提示中的团队名册选择成员；名册标注了每个成员的职责、适用与避免场景。' +
        '对标注「仅限任务类别」的成员必须传 taskKind。' +
        '成员带候补路由链：主路由失败会自动换下一条候补；若委派结果或成员后续回报显示额度不足/路由失败，' +
        '重新调用本工具并传 afterRoute = 上次失败的路由序号（从 1 开始），将从其下一条候补继续。' +
        '任务要写完整——成员看不到你们当前的对话。',
      parameters: {
        role: { type: 'string', required: true, description: '成员名字或 id，如「码农」或 "coder"' },
        task: { type: 'string', required: true, description: '完整的子任务描述（自包含：成员看不到当前对话历史）' },
        context: { type: 'string', description: '成员需要的上下文：相关代码片段、文件路径、约束、之前结论等' },
        taskKind: {
          type: 'string',
          description: '任务类别标签；受限成员（硬约束）必须是名册列出的类别之一，如 image / design / multimodal',
        },
        afterRoute: {
          type: 'number',
          description: '续试参数：上次某条路由失败后重试时，传上次失败的路由序号（1 开始），本次将从其下一条候补开始',
        },
        description: { type: 'string', description: '该委派的简短标题（5-10 词，展示用）' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok', 'role', 'routed', 'detail'],
          properties: {
            ok: { type: 'boolean' },
            role: { type: 'string' },
            routed: { type: 'string' },
            routeIndex: { type: 'number' },
            childSessionId: { type: 'string' },
            detail: { type: 'string' },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: typeof value?.detail === 'string' && value.detail ? `[穷哥们团队] ${value.role}: ${value.detail}` : JSON.stringify(value ?? null),
        }],
      },
      async execute(args, exec) {
        const team = await loadTeam();
        if (team.enabled === false) {
          return { ok: false, role: String(args?.role ?? ''), routed: '', detail: '穷哥们团队已关闭（总开关）。请提示用户重新开启，或直接自己完成该任务。' };
        }
        const verdict = validateDispatch(team, args);
        if (!verdict.ok) {
          return { ok: false, role: String(args?.role ?? ''), routed: '', detail: verdict.reason };
        }
        const role = verdict.role;
        const chain = role.routes.length > 0 ? role.routes : [{ provider: '', model: '', reasoningEffort: '' }];
        // afterRoute: 1-based index of the route that failed last time.
        // Absent → start from the primary; afterRoute=k → start at index k
        // (0-based), i.e. the candidate AFTER the failed k-th one.
        const after = Number.isFinite(args?.afterRoute) ? Math.max(1, Math.trunc(args.afterRoute)) : 0;
        const startIdx = after === 0 ? 0 : Math.min(after, chain.length);
        const attempts = [];
        const childBase = {
          description: String(args?.description ?? '').trim() || `穷哥们团队: ${role.name}`,
          prompt: composeChildPrompt(role, verdict.task, args?.context, teamNameOf(), args?.taskKind),
        };
        if (typeof exec?.cwdProvider === 'function') {
          try { childBase.cwd = exec.cwdProvider(); } catch { /* optional */ }
        }

        for (let i = startIdx; i < chain.length; i += 1) {
          const route = chain[i];
          const routed = routeText(route);
          const childArguments = { ...childBase };
          if (route.provider && route.model) {
            childArguments.provider = route.provider;
            childArguments.model = route.model;
          }
          if (route.reasoningEffort) childArguments.reasoning_effort = route.reasoningEffort;

          if (typeof tools.execute !== 'function') {
            return {
              ok: false,
              role: role.name,
              routed,
              routeIndex: i + 1,
              detail: `本环境没有可编程的委派管线。请直接调用 subagent 工具完成该任务：provider=${route.provider || '(默认)'}, model=${route.model || '(默认)'}，并以下面的提示词发起：\n${childArguments.prompt}`,
            };
          }
          try {
            const outcome = await tools.execute({
              name: 'subagent',
              arguments: childArguments,
              agent: exec?.agent,
              signal: exec?.signal,
            });
            const failed = outcome?.isError === true || outcome?.error !== undefined;
            const blocks = outcome?.content ?? outcome?.output ?? [];
            const text = (Array.isArray(blocks) ? blocks : [])
              .map((b) => (b?.type === 'text' ? b.text : ''))
              .filter(Boolean)
              .join('\n')
              .trim();
            if (failed) {
              attempts.push(`候选 ${i + 1}（${routed}）失败：${text || '未知错误'}`);
              continue; // quota / dead model / bad route → next candidate
            }
            const childId = outcome?.childSessionId ?? outcome?.sessionId ?? undefined;
            const prefix = i > startIdx ? '主路由不可用，已自动切换候补。' : '';
            return {
              ok: true,
              role: role.name,
              routed,
              routeIndex: i + 1,
              ...(childId ? { childSessionId: childId } : {}),
              detail: `${prefix}已把任务派给「${role.name}」（路由 ${i + 1}/${chain.length}: ${routed}）。${text || '子代理已启动，完成后会回报结果。'}`,
            };
          } catch (error) {
            attempts.push(`候选 ${i + 1}（${routed}）失败：${error?.message ?? error}`);
          }
        }

        const tried = attempts.length > 0
          ? `尝试过的候补：\n${attempts.join('\n')}`
          : '该成员没有可用的路由。';
        return {
          ok: false,
          role: role.name,
          routed: routeText(chain[chain.length - 1]),
          detail: `「${role.name}」所有路由候选都失败了（从第 ${startIdx + 1} 条开始）。${tried}\n可检查对应供应商的额度，或在设置卡中调整该成员的路由链后重试。`,
        };
      },
    };
    try {
      const defineTool = await loadDefineTool();
      ctx.effect(() => tools.register(shapeTool(definition, defineTool)), 'ai-team: team_dispatch tool');
    } catch (error) {
      console.error(`[${PLUGIN_NAME}] team_dispatch 注册失败: ${error?.message ?? error}`);
    }
  }

  // 4. Team roster section — the soft-constraint surface ("用话约束").
  const systemPrompt = ctx.systemPrompt;
  if (systemPrompt && typeof systemPrompt.section === 'function') {
    ctx.effect(() => systemPrompt.section({
      name: 'ai-team:roster',
      order: 850,
      interpolate: false,
      text: () => {
        const team = storeCache;
        return team ? rosterText(team) : '';
      },
    }), 'ai-team: roster section');
  }

  // Warm the cache so the roster is live from the first turn.
  loadTeam().catch((error) => {
    console.error(`[${PLUGIN_NAME}] initial team load failed: ${error?.message ?? error}`);
  });
}
