# 本地开发

插件版本为 0.0.1，目标宿主为 DSH 0.2.1-rc.3。代码入口见[仓库导航](../INDEX.md)，使用说明见[README](../README.md)。

插件用公开 `settings.section` 注册独立设置页，只写自身 namespace；传输部分可逆地包装活动 `PiAiAdapter.streamWithSnapshot`。当前实现不需要核心补丁，不能对 Desktop ASAR 执行 apply 或替换。

## 本机环境

使用 Node.js 22 或更新版本，并安装插件依赖：

```text
npm install --prefix plugin --ignore-scripts --no-audit --no-fund
```

完整测试还依赖被 Git 忽略的 `.runtime/`：Cordis、SettingsForms、Loader、历史路由回归使用的隔离补丁运行时，以及从未经修改的 rc3 安装包只读提取的适配器副本。先检查各测试的导入路径；不能用旧 patched 适配器冒充 rc3 副本。只克隆仓库并安装 npm 依赖，尚不足以运行完整套件。提取工具及其限制见[工具导航](../scripts/INDEX.md)。

## 检查

从仓库根目录运行：

```text
npm test
npm run check
npm run test:settings
npm run verify:link
```

`check` 包括语法、全部测试、隔离分发验证及发布元数据检查。`test:settings` 使用真实 SettingsForms、临时持久化替身和隔离 Loader 提交算法；不写用户配置，也不证明跨 namespace 授权。`verify:link` 读取本机 profile 的源码链接，不能证明模块已重载。

默认测试只请求本地模拟服务，使用合成密钥。rc3 网络测试比较主备请求体、路径、模型和参数；Cordis 事件测试中的 Agent 是替身。真实供应商探针需要显式环境变量授权，可能计费，不属于验收流程。

## GUI 验证范围

使用者已确认实际 Desktop 设置页正常渲染、可读供应商，保存后重启仍保留配置。断网错误中出现备用域名，说明真实请求已尝试备用线路；没有把真实备用服务成功返回作为验收条件。

原型依据是[独立设置页](../design/standalone-settings-ui.html)。旧 `node .runtime/check-ui.mjs` 只检查历史内嵌原型，不能代替当前页面验收。客户端源码热更新、跨 namespace 授权和解包 Web 登录态 E2E 尚未完成专项验证。

## 发布

根 README 和 LICENSE 是唯一编辑来源，发布前同步并校验：

```text
npm run sync:readme
npm run check
npm run test:settings
npm run pack:plugin
npm publish ./plugin --access public
```

先确保本机 `artifacts/` 目录存在。检查打包清单只含生产代码、元数据、locale、图标、README 和许可证；不得包含运行时、用户配置、日志、测试截图或凭据。插件 manifest 的 `files` 是分发白名单，版本必须同时更新根 manifest、插件 manifest 和插件 lockfile。

GitHub 提交前核对暂存清单和 diff。历史 rc2 工具保存在[归档目录](../archive/rc2/INDEX.md)，不运行它们来发布当前插件。发布后用 npm registry 查询版本与完整性，并确认 GitHub 标签指向同一次提交。
