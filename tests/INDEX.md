# 测试导航

从仓库根目录运行 `npm test`。完整套件依赖本机忽略的 `.runtime/`，准备方式见[开发说明](../docs/development.md)。测试不读取用户 API Key，不请求真实供应商。

- [transport-backoff.test.mjs](transport-backoff.test.mjs)：虚拟时钟验证主线退避、稳定恢复及备线粘滞。
- [transport.test.mjs](transport.test.mjs)：内存包装、错误分类、全部冷却、部分输出与取消。
- [transport-host.test.mjs](transport-host.test.mjs)：真实 Cordis 轮次事件、跨会话冷却、释放和卸载；Agent 为替身。
- [transport-rc3.test.mjs](transport-rc3.test.mjs)：未经修改的 rc3 适配器连接本地 HTTP 模拟服务，比较请求体、路径、模型及合成密钥。
- [transport-partial-rc3.test.mjs](transport-partial-rc3.test.mjs)：真实 rc3 适配器接收部分 SSE 后遇到 EOF 或明确 server_error；连接真实 llm-retry 验证错误分类、策略排除和预算，不在流内重放，新尝试再用备线。
- [transport-rc5.test.mjs](transport-rc5.test.mjs)：未经修改的 rc.5 npm 适配器连接本地 HTTP 模拟服务，核对主备请求一致与同轮粘滞。
- [transport-partial-rc5.test.mjs](transport-partial-rc5.test.mjs)：rc.5 适配器与重试器验证部分 SSE、EOF、server_error 分类及下一次宿主尝试切线。
- [legacy-router.test.mjs](legacy-router.test.mjs)：当前客户端校验/Config 测试，以及依赖历史隔离补丁运行时的路由回归；旧用例的“下一轮主线重置”不描述当前 transport 策略。
