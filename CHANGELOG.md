# CHANGELOG

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
