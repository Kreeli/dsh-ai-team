# CHANGELOG

## 0.3.0 — 2026-11-03

- **模型目录收窄到实际可派单的白名单**。
  - 根因：DSH 的 `subagent-model-selection-settings.allowedModels` 只允许 12 条 provider/model，而卡片下拉列出的是 llm 注册表全量目录（48 个 provider）。用户能选到白名单外的路由，派单时必然失败——实测「软件页面测试」前 4 条候选全废，一路切到第 5 条才成功。
  - 修复：新增 `allowedRouteKeys()`，从 `ctx.subagentModelSelection.current()` 读当前 Session 的精确白名单；`buildProviderCatalog()` 据此过滤模型、丢弃无可派单模型的 provider。服务缺失/白名单为空时不过滤（安全回退）。
- **禁止空路由**（修复静默回退到 Leader 模型的问题）。
  - 根因：`provider`/`model` 都为空的候选路由，派单时不会传 provider/model，子代理会静默使用会话默认模型——即输入框右下角选择的那个。
  - 修复：`sanitizeRole()` 用 `isDispatchableRoute()` 过滤掉不完整路由，不再持久化；卡片里移除「（继承默认路由）」选项，空路由显示醒目占位提示。
- 新增 `test/catalog-allowlist-smoke.mjs`：覆盖白名单收窄、provider 剔除、无白名单时不过滤、空路由拒绝。
- 实测：修复后 4 个启用角色（架构师/笔杆子/代码审查员/软件页面测试）均**一次命中主路由**，不再触发候补切换。

## 0.2.2 — 2026-11-03

- **修复：点击工具栏「穷哥们团队」按钮无反应**。
  - 根因：`client.js` 里 `TeamButton` 调用 `setOpenCard(true)`、`TeamCard` 调用 `useCardOpen()`，但这两个符号**从未定义**。点击时抛 `ReferenceError`，卡片组件因此渲染崩溃（Slot `shell.overlay` 的 `ai-team-card` 一直是 `active: false`）。
  - 修复：新增模块级共享状态 `cardState` + `setOpenCard()` / `useCardOpen()`，用 `useSyncExternalStore` 打通「工具栏按钮」与「浮层卡片」两个独立 slot 注册之间的开合状态。
- 新增 `test/client-open-smoke.mjs`：用 React hooks shim 真实执行 client.js，断言「初始关闭 → 点击按钮 → 卡片打开 → 点击遮罩 → 关闭」全链路。
- 验证：`shell.overlay` 的 `ai-team-card` 已 `active: true`；served bundle 含 `cardState` 定义。

## 0.2.1 — 2026-11-03

- **插件源码迁到工作目录根**：源码目录整体上移一层，直接位于用户的工作目录；profile 的 `link:` 与 `pnpm-lock.yaml` 同步改为新绝对路径（跨盘符必须用绝对路径），`node_modules/@local/dsh-ai-team` junction 重建指向该目录。
- **清理历史残留**：移除遗留 profile 里失效的 link 依赖，以及早期修复过程中产生的重复插件副本。
- 验证：`/ai-team/api` 200（roles=7, providers=49）、client bundle 200、工具栏 slot `ai-team-toolbar` active、冒烟测试全绿。

## 0.2.0 — 2026-11-03

- **总开关**：卡片开关一键启停整个团队，guard / 工具 / 名册三处同时生效。
- **路由候补链**：每个角色可挂多条候选路由（Provider/Model/推理力度），主路由失败自动切下一条；`team_dispatch` 支持 `afterRoute` 从失败路由的下一条续试。
- **工具栏按钮迁移**：`conversation.input.left`（与「智能体团队」「创造模式」并排）→ `shell.overlay` 设置卡片。
- **推理力度选项卡**：`默认 / off / minimal / low / medium / high / 自定义`。
- **7 个预设角色**：架构师、码农、笔杆子、设计师（仅限 image/design/multimodal + 硬约束）、剪辑师、代码审查员、资料调研员，均带双路由候补链。
- **预设迁移（presetVersion 2）**：旧存档一次性补齐新增角色，并给单路由角色追加同家族候补。
- **插件源码迁移**：从最初的开发目录迁到独立工作目录；profile 的 link 与 pnpm-lock 同步改为新路径。

## 0.1.0

- 初版：单路由角色、设置卡片、`team_dispatch` 工具、名册注入、硬约束 guard。
