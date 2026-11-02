# 穷哥们团队 · dsh-ai-team

给 [DeepSeek Harness](https://github.com/deepseek-ai) 的多模型 AI 团队插件：在设置卡片里定义团队成员，每个成员绑定自己的**路由候补链**，主模型通过 `team_dispatch` 工具把子任务派给成员执行。主路由额度不足或模型下线时，候补自动顶上。

> 版本 **0.2.2** ｜ 插件包名 `@local/dsh-ai-team` ｜ 平台 Web / Desktop

## 能力

- **总开关**：卡片右上角的开关控制整个团队——关闭后主模型无法派单（guard 直接拦截并提示），工具栏按钮同步变灰。
- **自定义角色 × 路由候补链**：每个角色 = 名称 + 路由链（主路由 → 候补 1 → 候补 2…，每条路由独立配 Provider/Model/推理力度）+ 系统提示词 + 适用/避免场景 + 任务类别约束 + 启用开关。主路由失败（额度不足、模型下线、连接失败）**自动切换下一条候补**；候补全部失败才报错，并附上每条候补的失败原因。成员后续回报失败时，主模型可传 `afterRoute` 从失败路由的下一条续试。
- **软约束（名册注入）**：启用角色的职责与适用/避免场景注入每个 agent 的系统提示，主模型自主选人；不写约束即自由调用。
- **硬约束（按角色开关）**：受限角色必须传名册列出的 `taskKind`（如 image / design / multimodal），传错被 guard 直接拒绝。
- **实时模型目录**：设置卡片的「模型路由」下拉与聊天框右下角模型选择器**同源**（读 `llm` 注册表），按提供方分组；提供方目录变化（模型上下架）自动跟随。
- **推理力度选项卡**：`默认 / off / minimal / low / medium / high / 自定义`，不再手填。
- **预设团队（7 角色）**：架构师、码农、笔杆子、设计师（仅限 image/design/multimodal + 硬约束）、剪辑师、代码审查员、资料调研员。每个预设自带双路由候补链。

## 界面

- **工具栏按钮**：输入框工具栏左侧（`conversation.input.left`），与「智能体团队」「创造模式」并排。
- **设置卡片**：点击按钮在 `shell.overlay` 浮层中打开，含团队名、总开关、角色列表与路由链编辑器。

## 安装

插件以 bundle 形式安装到 DSH profile：

```sh
# 在 DSH 里通过插件管理器安装本地目录，或
dsh plugin --profile <profile> add <path-to-this-dir>
```

本地开发时，用 junction / 软链接把插件目录挂进 profile 的 `node_modules/@local/dsh-ai-team`，并在 profile 的 `package.json` 里声明：

```json
"@local/dsh-ai-team": "link:<absolute-path-to-this-dir>"
```

> 跨盘符的 link 依赖**必须用绝对路径**（`link:D:/...`），相对路径在盘符变化时会失效。

## 数据与升级

- 团队配置存于 `$DSH_HOME/ai-team/team.json`（跟随 `DSH_HOME` / `DSH_PROFILE_DIR`），由仅限本机回环的 `/ai-team/api` 路由读写。
- **预设升级**：旧存档（v1 单路由）在插件加载时一次性迁移——补齐新增预设角色、给单路由角色自动追加同家族的候补路由，用户已有配置不动。

## 文件结构

```
index.js            Host 半区：存储 / 路由 / team_dispatch / guard / 名册 / 迁移
client.js           Client 半区：工具栏按钮 + shell.overlay 设置卡片
cordis.patch.yml    bundle 补丁
package.json        bundle 清单
locale/*.json       中英文本地化
icon.svg            图标
test/
  apply-smoke.mjs         Host 半区冒烟测试（隔离 DSH_HOME 临时目录）
  client-open-smoke.mjs   Client 开合链路测试（React hooks shim）
```

## 验证

```sh
node test/apply-smoke.mjs        # Host：迁移 / 候补链 / afterRoute / 全败报告 / 硬约束 / 总开关
node test/client-open-smoke.mjs  # Client：初始关闭 → 点击按钮 → 卡片打开 → 点遮罩 → 关闭
```

## API 契约

`/ai-team/api`（Host 路由，仅回环 + 无 Origin 头）：

| 方法 | 载荷 | 行为 |
|---|---|---|
| `GET` | — | `{ teamName, enabled, roles, providers }` |
| `POST` | `{ enabled }` | 仅切换总开关，不误存未保存编辑 |
| `POST` | `{ teamName, roles }` | 全量保存（sanitize 后返回最新 summary） |
| `POST` | `{ reset: true }` | 恢复默认团队 |

错误返回 `{ error }`；403 = 非回环/带 Origin，413 = 载荷超 256KB。

## team_dispatch 工具

```
参数: role*(成员名或id) | task*(自包含任务) | context(上下文)
      | taskKind(受限角色必填) | afterRoute(上次失败的路由序号,1起) | description(标题)
输出: { ok, role, routed, routeIndex?, childSessionId?, detail }
```

行为：总开关关闭 → 拒绝；角色未启用/不存在 → 拒绝并列出可用成员；硬约束角色 `taskKind` 不合法 → guard 拒绝；按 `afterRoute` 起点遍历路由链，`isError`/抛错即切下一条；全败 → `detail` 携带每条候补的失败原因。

## License

MIT
