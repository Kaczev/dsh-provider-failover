# 备用地址实施计划

## 当前执行基准（rc3，取代下方历史 rc2 方案）
- UI 唯一设计来源：[standalone-settings-ui.html](standalone-settings-ui.html)，固定两个可留空输入框，无添加/排序/删除按钮。
- 请求仅覆盖本次调用模型副本的 baseUrl；options、snapshot、模型、密钥和参数保持原样，不修改 ASAR 或持久供应商配置。
- 主线失败冷却依次 30/60/120/240/300 秒；只在新轮次到期探测。同轮保持当前线路；备线 2 正常不主动探测备线 1。稳定使用 5 分钟且成功至少两次才清零故障历史。
- 每条线路独立冷却；全部冷却时返回故障给宿主重试，不发后台探测。健康状态仅保存在适配器实例内存，地址表变更重置。
- 验收：npm test、npm run check、npm run test:settings、npm run verify:link、node scripts/checks/verify-deployment.mjs。本地模拟网络验证请求体不变，不要求真实备用服务返回成功。
- 已通过 26 项测试与上述配置/分发检查；公开管理器停用/启用返回 applied。使用者已确认 GUI 正常渲染、保存并重启后配置仍保留；断网错误显示尝试备用域名。

## 历史 rc2 方案（以下不再用于当前实现）

目标：在 DSH 0.2.1-rc.2 的供应商编辑卡片里，于「自定义设置」之后、模型目录分隔线之前，加入可增删、可校验、可持久化的备用 API 地址编辑区；视觉以 [backup-address-ui.html](backup-address-ui.html) 为准。

状态：设计已完成并验证；实现未开始。当前 Desktop 的 `app.asar` 未打补丁，本轮不能承诺 GUI 可见。

## 一、已核实的事实

- 本仓库 `plugin/index.js` 只有 host 半包：`validate`/`createRouter`/`apply`，从 `config.providers` 读取 `{enabled, confirmCredentialRecipients, backups}`；没有 `Config` schema，也没有客户端半包。
- `plugin/package.json` 的 `exports` 只有 `.`、locale、icon；`dsh` 只有 bundle patch。
- 模型设置页在 `dsh-client-ui-settings-models/lib/client.js`：`settings.section`（id `models`，order 10）声明了 `settings.models.provider-card`（keyed，scope root，entryKey = settingsNs）和 `settings.models.footer`；`ProviderEditor` 在 `client.js:1856`，props 包含 `namespace`（`namespace.ns` 即 settingsNs）、`schema`、`operations`、`provider`、`readOnly`。
- 编辑卡片内没有现成插槽；卡头槽位由 `client.js:2541`、`2616`、`2725` 渲染，位置在 rowHead 之后、编辑器之前。
- keyed 槽注册形如 `ctx.slots.register({ name, key: 'llm-pi-ai' }, Component)`；分发使用 `entryKey = settingsNs`。
- `remote.settings.describe()` 返回 `{ writable, hasDocument, namespaces: [{ ns, schema, value, base, user, revision, applies, secrets }] }`；`mutate(ns, ops, expectedRevision)` 的 ops 为 `{ op: 'set'|'unset', path, value }`（`dsh-api-settings-controller/lib/index.js`）。
- Host 设置服务只允许 `.volatile()` 字段；`dsh-llm-pi-ai/lib/index.js:1083` 已有先例 `providers: z.dict(profile).default({}).volatile()`，并在 `loader/volatile-update` 后重注册 provider，说明「volatile dict + 路径写入 + 实时更新」在宿主里是既有模式。
- `cordis-plugin-loader/lib/index.js:422` 在 volatile 值变化后发出 `loader/volatile-update`（参数为变化路径数组），并且先原地更新配置引用，再派发事件。
- 当前仓库没有 `node_modules`，profile 用 `link:` 指向本仓库 `plugin`；若插件 `import '@deepseek-ai/schemastery'`，必须在插件目录（或仓库可解析路径）安装该依赖，否则加载失败。
- 当前 Desktop ASAR 未打补丁；`install-core.mjs` 明确拒绝 `.asar`。`prepare-desktop.mjs`/`deploy-desktop.ps1` 是未验证的离线重打包通道，本轮不得 apply。

### 参考插件调研（2026-10-24）

- `billion-context`：客户端包 `dist/agent/dsh-native-client.js`（本地未构建），`dsh.client = { platform: "web", inject: ["slots", "locale"] }`；除 settings.section 外，还能注册 `conversation.view`、`plugins.bundle.config`；宿主用 `ctx.inject(["webServer"])` + `ctx.webServer.register(...)` 自建同源路由，状态落 `$DSH_HOME`。
- `dsh-context`：客户端注册 `conversation.view`、sidebar、输入区与 `plugins.bundle.config` 配置卡；配置走官方 `configForms` + 插件 `Config` 的 `.volatile()` 字段（客户端 `settings.attach` / `.set(field, value)`）。宿主用 `connection.fetch.register({ path, methods: ["POST"], requestBody: "buffered", fetch })`（封装在 `src/host/connection.ts:30` 的 `registerPostRoute`），客户端 `fetch("api/dsh-context/detail")`。
- `dsh-cost-meter`：`dsh.client` 无 invoke 列表，`inject: ["remote"]`；`ctx.remote.$mount(TYPERT)` 后用 `ctx.remote.costMeter` 走 Typert RPC（`lib/typert.host.js` 手写 zod schema，`./typert` 导出）。客户端注册 `settings.section`（自带页面）、`plugins.bundle.config`、`sidebar.footer.action`、`conversation.composer.dock`、`settings.general.item` 等；账本落 `join(resolveDshHome(), "storages", "cost-meter", "ledger.json")`，`lib/billion-context-history.js:25-32` 用临时文件 + `renameSync`、`mode 0o600`、目录 `0o700` 并拒绝符号链接。
- 结论：插件可以自建设置页/侧栏按钮/对话区组块/同源 POST 路由，也可以持久化任意 JSON；但 `settings.models.provider-card` 仍是唯一公开的供应商卡片席位，编辑器内部（箭头处）没有公开槽位，必须客户端补丁。无补丁的退路是「独立 settings.section 页面」或「plugins.bundle.config 配置卡」，不是箭头位置。


## 二、方案决定

1. **位置**：给 `dsh-client-ui-settings-models/lib/client.js` 打客户端补丁，新增 keyed 槽 `settings.models.provider-editor`，在 `ProviderEditor` 的自定义设置 `</details>` 之后、模型目录分隔线之前调用 `renderSlot`。参数：`{ provider, settingsNs: namespace.ns, readOnly: props.readOnly }`，`entryKey` 用 `namespace.ns`。
2. **写入通道**：优先使用官方 `settings.mutate` + 把插件 `providers` 设为 volatile，不自建 HTTP 路由、不另建存储。**先过 P0 门禁；P0 不通过就停下，把证据和「退路 B（JSON+路由）」一起报告，由用户决定，不静默切换。**
3. **客户端半包**：手写 `plugin/client.js`，使用官方 `window.__ModuleLoader__.load` 包装器、`require('react')`/`react/jsx-runtime`，不引入打包器。UI 状态与校验照设计稿实现，CSS 以字符串注入一次。`dsh.client = { platform: "web", inject: ["slots", "remote"] }`（至少能拿到 `ctx.slots` 与 `ctx.remote.settings`；加载器若要求别的服务名，按实际报错补齐）。
4. **宿主半包**：新增 `Config` schema，`providers` 标 `.volatile()`；监听 `loader/volatile-update` 重新 `validate` 并热替换路由表，失败只记录、保留旧表。
5. **数据归属**：备份地址仍存插件自己的 `providers.<providerId>.backups`；不写入供应商记录、不改 model/key。
6. **P0 失败时的退路（需报告后再动）**：保持 UI 与补丁不变，把写回改为「自有 JSON + 同源 POST 路由」：`$DSH_HOME/storages/provider-line-failover/backups.json`，原子写（临时文件 + rename、0600、拒绝符号链接），宿主 `connection.fetch.register({ path: "/api/provider-line-failover/backups", methods: ["POST"], requestBody: "buffered" })`，客户端同源 `fetch`；插件配置只作首次迁移种子，存储优先。该模式由 cost-meter / dsh-context 实际使用，但比 volatile 设置多一个 HTTP 面，必须跟随 P0 报告由用户确认后再实现。

## 三、P0 门禁（先做，失败即停）

必须同时拿到证据：

1. **依赖可加载**：`plugin/index.js` 能解析 `@deepseek-ai/schemastery`（在 `plugin/` 安装 `~3.18.5`，或确认打包安装会带依赖）；写一个最小加载测试证明 `import` 成功。若无法在链接安装下解析，先停下说明，不改成绝对路径 hack。
2. **可写**：用 P0 脚本构造真实 `dsh-settings` 服务（stub `configEditor.entries()` 提供本插件 schema），断言：
   - `describe()` 能列出本插件 namespace；
   - `mutate(ns, [{op:'set', path:['providers','four-router'], value:{enabled:true, confirmCredentialRecipients:true, backups:[...]}}], revision)` 成功；
   - 对 `hostAdapterModuleURL` 的写入抛 `Config field "..." is not volatile`。
3. **跨 ns 不受限**：确认 settings controller 未按 ns 做权限白名单；在报告里注明这是代码审阅结论，仍属未实测的服务端信任边界。
4. **实时生效**：模拟/构造 `loader/volatile-update` 后，插件的路由表拿到新 backups（或证明 `config.providers` 是原地更新、可从闭包读到）；若只能重启生效，写明并给 UI 增加「重启后生效」提示，不得假装热更新。

P0 证据落到 `verify-settings-write.mjs`（新增脚本），失败信息要包含具体错误文本。

## 四、实施步骤

### P1 宿主插件

- `plugin/package.json`：加 `dependencies: { "@deepseek-ai/schemastery": "~3.18.5" }`；`exports` 加 `"./client": "./client.js"`；`files` 加 `client.js`；`dsh.client = { platform: "web", inject: ["slots", "remote"] }`（以 dsh-client-modules 实际校验为准，最小可用即可）。
- `plugin/index.js`：
  - 用 schemastery 定义并导出 `Config`：`hostAdapterModuleURL`（string，default `@deepseek-ai/dsh-llm-pi-ai`）、`allowLocalHttp`（boolean，default false）、`providers`（`z.dict(z.object({ enabled: z.boolean().default(false), confirmCredentialRecipients: z.boolean().default(false), backups: z.array(z.string()).default([]) })).default({}).volatile()`）。
  - 保留 `validate`、`eligible`、`createRouter` 的导出与语义，`npm test` 现有 17 条必须不变。
  - `createRouter` 增加 `reload(nextConfig)`：重新 validate 后替换内部 providers；已在进行中的请求保留旧快照，新请求用新表。
  - `apply` 注册 `ctx.on('loader/volatile-update', ...)`，只处理与 `providers` 相关的路径；失败用 `ctx.logger?.warn` 记录，不抛出。
  - 关闭故障切换仍保留 backups（validate 已跳过 disabled）。
- 若新增 Config 后宿主启动校验拒绝配置文件，优先修正 schema 默认值，不要放宽 `validate` 的安全规则。

### P2 客户端 UI

- 新建 `plugin/client.js`（单文件 loader bundle）。注册 `settings.models.provider-editor`，`key: 'llm-pi-ai'`。
- 组件逻辑：
  - `describe()` 找到 `ns === 'kaczev-provider-line-failover'` 的 view；按 `props.provider` 读取 `{enabled, confirmCredentialRecipients, backups}`；缺失时默认关闭、空列表。`writable === false` 或 `props.readOnly` 时只读。
  - 保存用 `mutate(NS, [{ op:'set', path:['providers', providerId], value:{...existing, enabled, confirmCredentialRecipients, backups} }], revision)`；成功后显示「已保存」，冲突提示重新加载。
  - 校验与门禁照设计稿：https、禁止账号/查询/锚点、与主地址重复、互相重复、去尾斜杠、启用需至少一条、启用需勾选确认；空行阻止保存。
  - 组件不渲染在非 pi-ai 的 settingsNs；草稿卡未保存时允许填写但只在保存供应商后落盘（若拿不到 provider id 就隐藏）。
  - 订阅 `ctx.remote.$on('settings/document-updated')` 刷新；卸载时释放。
- 视觉按设计稿：区块标题、故障切换标签、启用开关、行号输入与上/下移/删除、添加按钮、确认复选框、说明行；只读/空/保存中/错误状态齐全。
- 不复制设计稿里右上角的「原型控制」面板与红色标注。

### P3 客户端补丁

- 复制 `.runtime/node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js` 到 `core/patched/...`，做两处最小改动：
  1. section children 增加 `"settings.models.provider-editor": { kind: "keyed", scope: "root" }`；
  2. `ProviderEditor` 在自定义设置 `</details>` 之后、模型目录分隔线之前插入 `renderSlot("settings.models.provider-editor", { provider: props.provider, settingsNs: namespace.ns, readOnly: props.readOnly }, { entryKey: namespace.ns })`。
- 不改其他行为；用最小字符串 diff，保存原文件供 manifest 计算。
- `core/manifest.json` 增加该文件的 originalSha256/patchedSha256，并确认原 sha 与 `.runtime` 及 Desktop ASAR 内文件一致；不一致就停，不要用错版本打补丁。
- `install-core.mjs` 无需改动（按 manifest 循环）；确认 `prepare-desktop.mjs` 能重算 candidate，但本轮只允许生成 candidate 与 `deploy-desktop.ps1 check`。

### P4 测试与文档

- `test.mjs` 增加：Config 的 `providers` 是 volatile、reload 后 routes 使用新 backups、validate 仍拒绝 http/账号/重复/空。
- `verify-settings-write.mjs`：P0 的持久化证据。
- 扩展 `verify-deployment.mjs`：断言 manifest 含客户端文件、安装后 `plugin/client.js` 存在且 sha 一致；保留现有 502→hk 切换断言。
- 更新 `README.md` 与 `LOCAL-DEVELOPMENT.md`：新增 UI 与写回说明、依赖安装、补丁清单（三个文件）、Desktop 仍不可见、恢复到 original 的命令。
- 设计稿只作为视觉来源；若实现中必须偏离（例如 slot props 不同），把偏离写进 README 并在回复中说明，不改设计稿。

### P4.5 解包运行时 E2E（尝试，有明确失败条件）

- `.runtime` 内含 `@deepseek-ai/dsh` 0.2.1-rc.2 CLI：`node .runtime/node_modules/@deepseek-ai/dsh/lib/bin.js web --port 0 --no-open` 可 boot 解包 web profile（`--help` 已确认）。
- 在**隔离的 DSH_HOME 副本**（不要直接改用户的 `%USERPROFILE%\.dsh`）里启用本插件 bundle、放入已补丁的 `dsh-client-ui-settings-models/lib/client.js`，启动 web UI，用 CDP 按设计稿检查：卡片编辑区内出现备用地址区；增删/校验/保存；重载页面后数据仍在；`hk.4Router.net` 切换仍生效。
- 若隔离副本缺少登录态或凭据导致设置页不可达，记录具体阻塞（命令、错误、截图）后停止 E2E，不得伪造「已验证」；单测与原型断言仍然必须通过。
- 该步骤只改 `.runtime` 与临时 DSH_HOME，不触碰 `app.asar`、不 apply Desktop 候选。


## 五、验收

已确认可跑（本轮基线）：

- `npm test`：17/17 通过。
- `npm run check`：退出 0（会打印一次预期的 checksum 负例）。
- `npm run verify:link`：profile `%USERPROFILE%\.dsh\profiles\desktop` 链接正确。
- `node .runtime/check-ui.mjs`：原型 30 项交互断言通过。

本轮新增，必须实际跑过：

- `npm test`（含新增用例）
- `node verify-settings-write.mjs`
- `npm run check`
- `npm run verify:link`
- `node verify-deployment.mjs`
- `node prepare-desktop.mjs`（仅生成 candidate；不 apply）

**不能验收（Desktop）**：当前 Desktop GUI 看不到新 UI，ASAR 未部署；不要用截图或口头推断代替。解包 web 运行时的 E2E 是**另外的**验证面，成功也不等于 Desktop 已生效。

## 六、风险与未知

- schemastery 依赖在 `link:` 安装下的解析；离线时从 `.runtime` 复制到 `plugin/node_modules`，但打包分发需另行确认安装器会装依赖。
- 跨 ns 的 settings 写入没有显式 ns 白名单，但这是本机同源 Remote，仍需在 P0 报告里标注信任边界。
- `loader/volatile-update` 与插件闭包 config 的联动未实测；若拿不到新值，需在 P0 结论里给出可行的读取方式，不要靠重启掩盖。
- 客户端 bundle 的 `dsh.client` 元数据与 `dsh-client-modules` 的构建/加载要求未完全确认；若要求构建产物，先停，不要提交半可用 bundle。
- 补丁会随 DSH 升级失效；沿用现有 manifest 校验与恢复流程。
- 插件设置页可能额外展示 `providers` 的原始 JSON（因为它是 volatile）；若出现，记录为已知表现，不为此改 schema 结构。

## 七、完成标准

- P0 有结论；若失败则任务停在此并报告证据与退路 B 的取舍，不静默改架构。
- 宿主、客户端、补丁、测试、文档全部落地，验收命令真实通过。
- 回复只报告改动、验证结果、未验证项（GUI/ASAR），不写交接提示词。
