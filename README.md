# 供应商请求线路切换 · 0.1.0

适用宿主：DSH **0.2.1-rc.2**，使用 `@deepseek-ai/dsh-llm-pi-ai` 的显式 API Key 供应商。已完成插件、本地模拟测试和两文件核心补丁。当前 Desktop 已通过仓库 `link:` 安装 bundle，但保持禁用；Desktop ASAR 未打补丁，切线功能尚未激活。没有调用真实付费 API，没有改动供应商、模型或密钥。

本机仓库链接与更新步骤见 [本机单源开发](LOCAL-DEVELOPMENT.md)。

## 为什么需要核心补丁

实际检查的官方 `llm/stream` waterfall 只接收不可变请求与无参数 `next()`，GenerateOptions 没有 URL 字段。适配器预先绑定共享模型快照，插件无法安全替换单次调用的 URL。按已获同意的最小改动，补丁只修改：

- `@deepseek-ai/dsh-agent-loop/lib/index.js`：每个 step 新建不可变 `transportRequest` 对象，同一步的宿主重试复用此对象。对象不写入持久日志。
- `@deepseek-ai/dsh-llm-pi-ai/lib/index.js`：增加 **自定义、非原版官方接口** `llm-pi-ai/request-base-url` waterfall，参数 `(options, primary, next)`；适配器浅复制请求模型并覆盖副本的 `baseUrl`。同时补齐 HTTP 408 分类，以及流空闲超时被清理逻辑覆盖后丢失 TIMEOUT 分类的问题。

插件要求 `requestBaseURLVersion === 1`，未打补丁会拒绝加载。补丁针对本机发布后的 JavaScript，不是上游 TypeScript 源码提交；没有同步宿主类型声明和 Inspect 元数据，也不承诺未来版本兼容。请勿将新增事件误认为原版 DSH API。

## 线路、错误与流式规则

同一步请求从供应商现有主地址开始，合格故障后下一次**宿主重试**依次使用 backup 1、backup 2……到末尾后保留最后一个备用地址。主地址不写入插件配置，也不持久修改。

`normal` 模式沿用宿主原有次数上限和退避。重试耗尽后按宿主机制报错；切线不增加次数。`always` 模式本来就无限重试，插件仍能切线，到末尾后继续最后一条线路，直到宿主取消或请求成功。插件没有另建重试循环。

下一个 step、新一轮请求、取消后重发或进程重启，都用新的请求标识，从主线重新开始。并发请求各自用 WeakMap 状态，不按 sessionId 共享，不更改全局适配器或模型集合。

- 切线：宿主分类 TRANSPORT / TIMEOUT，以及明确的 HTTP 408、502、503、504。
- 不切线：401/403、INVALID_REQUEST、CONTEXT_WINDOW_EXCEEDED、取消、429；429 保留宿主原有退避。HTTP 500 等其他状态也不切线。
- pi-ai 当前丢弃结构化 HTTP status，因此插件优先用宿主 `failure.status`，否则只解析错误文本开头的 HTTP 状态；不在正文任意位置搜索数字。无法确认的错误不切线。
- 已有 block/text/reasoning/tool 输出后出现错误，插件抛出 `FAILOVER_PARTIAL_STREAM`，直接终止本次请求，**即使 always 也不重放**。原宿主会丢弃失败 attempt 后重试，无法保证用户已见文本不重复；此插件选择明确失败，而非声称支持断点续传。工具仅在宿主成功完成后执行。仅 block-start 也按已输出保守处理。
- 用户取消沿用原 AbortSignal，不切备用。

插件不输出日志，不记录密钥或请求正文。测试仅在内存检查合成测试密钥。宿主自身的日志策略不由本插件改变。

## 配置

安装包默认 `enabled: false`、`confirmCredentialRecipients: false`。备份地址是新的密钥接收端；只有你确认愿意向它发送同一个 API Key 后，才把两项改为 true。示例见 `config.example.yml`。域名大小写会按 URL 标准规范化；`hk.4Router.net` 与 `hk.4router.net` 是同一主机。

配置以真实供应商 ID 为键。保留 `four-router` 原主地址 `https://4router.net/v1`，不新增供应商，不切模型、不更换协议或参数。只支持 HTTPS；`allowLocalHttp: true` 仅供环回模拟服务，不应在生产启用。拒绝带用户名、密码、query、fragment 的备用 URL。没有新增设置界面。

## 安装与卸载

### 部署前提

本机 Desktop 的运行时位于 `resources/app.asar/dsh`。**此版本安装器不支持直接修改 ASAR，也未提供经过验证的 Desktop 重打包/签名/升级方案。当前 Desktop 不能仅靠导入 tgz 获得功能。** 随包 tgz 可用于已经应用补丁的同版本解包运行时；如继续部署到 Desktop，需要另行完成离线 ASAR 部署与回滚验证。不要把工作区 `.runtime` 测试副本当成已安装应用。

### 同版本解包运行时

1. 停止目标 DSH；备份运行时和 profile。目标必须是 DSH 根目录，包含 `package.json` 和 `node_modules`。
2. 在本目录执行（将 `<DSH_ROOT>` 替换为真实解包目录）：

   ```text
   node install-core.mjs check <DSH_ROOT>
   node install-core.mjs apply <DSH_ROOT>
   ```

   安装器同时验证版本、全部原文件校验和与产物校验和；发现本地修改就拒绝覆盖。写入前验证全部文件，但多文件写入不是事务，进程被强杀时请重新运行 check/apply 或 restore。
3. 启动该运行时，在它的 DSH 插件管理器中安装 `kaczev-dsh-provider-line-failover-0.1.0.tgz`。若通过 agent 操作，先 `plugin_manager` 列出 bundle，再用 `install_bundle` 和安装包绝对路径；不要手写 profile 的 package.json。安装结果须确认 applied，且插件无错误。
4. 在插件配置中核实供应商 ID、备用地址，明确确认密钥接收端后，启用 `enabled` 和 `confirmCredentialRecipients`。用户配置样式参见示例；修改后应由宿主重载插件。先在独立测试 profile 验证，不要直接做付费探测。

卸载：先在插件管理器移除 bundle `@kaczev/dsh-provider-line-failover`；停止目标 DSH，执行 `node install-core.mjs restore <DSH_ROOT>`，再启动。恢复同样拒绝覆盖未知文件。不要只恢复核心却保留启用的插件。

## 实际验证

执行环境 Windows、Node v24.19.0。命令：

```text
npm run check
npm run verify:link
npm run pack:plugin
```

命令工作目录为本仓库根目录；维护脚本按自身位置定位文件，不再依赖旧工作区路径。测试依赖从本机安装版提取的 `.runtime`，交付压缩包不包含这份约 425 MB 运行时。测试源码保留，复验时须提供同版本运行时并应用补丁。

本地测试报告 `test-results.txt`：**16 个子用例全部通过**（Node 连同外层测试计 17/17）。覆盖 502 切备用；备用全部故障与预算不变；多备用顺序；always 切线及末线路取消；401/403/400/429不切线；408；连接断开；空闲超时；取消；并发隔离；主线复位；URL `/v1/chat/completions` 与 `/v1/proxy/chat/completions` 拼接；部分 SSE 中断；工具/推理块的保守终止；辅助 purpose 隔离；禁用/未配置供应商；信任确认和错误正文数字误判。

测试真实加载 PiAiAdapter、pi-ai streamSimple、LlmRuntime.adapterStream 与宿主重试插件，HTTP/SSE 只连接本地模拟服务。Agent 的外层驱动和 session projection 存储用测试替身，**不是完整 Agent/GUI 端到端测试**；工具/推理中断测试注入宿主 chunk，不是实际工具执行。429 验证的是不切线和仍调用原宿主重试，没有测量生产退避时长。未分别对所有协议实测 URL 拼接；当前网络测试协议为 openai-completions。

部署验证报告 `deployment-results.txt`：插件 apply 成功注册两个事件，调用可从主线切备用；安装器 check/apply/restore 成功，故意篡改文件后拒绝覆盖（报告中的校验错误是预期的负例）。这是在运行时包目录内的插件注册验证，没有完整 Cordis Loader 启动及当前 profile 激活验证。

## 辅助调用与限制

- 标题生成：已读 `dsh-session-title-llm` 实现，只调用一次 prepareCall/stream，没有 agent/request-error 重试；本版本**不对标题切线**。
- 压缩：已读 `dsh-compaction-basic` 实现，只调用一次 llm.stream；本版本**不对压缩切线**。
- 同宿主 spawn/fork 子代理：已核查它们共享宿主上下文并创建独立 Agent，使用同一打补丁的 agent-loop 时应覆盖，状态按 step 隔离。未实际启动完整子代理验证；远程或独立进程子代理必须在其宿主另装，不能声称自动覆盖。
- URL 覆盖要求供应商显式 API-key 配置。OAuth、自定义非 pi-ai 适配器、无请求标识的直接 llm.stream 调用不受支持；不通过修改共享 OAuth 模型实现绕过。
- 没有主线健康探测、跨请求熔断、自动回切计时器或日志面板。重试轮转只在单次 step 内有效。备站是否具有相同模型、协议和权限由供应商保证。
- 核心补丁会被宿主更新覆盖；版本或校验和不一致时需重新适配，不要强制跳过检查。
