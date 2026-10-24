# 工具导航

所有命令均从仓库根目录执行。发布包不包含此目录。

## checks：隔离检查
- [verify-settings-write.mjs](checks/verify-settings-write.mjs)：真实 SettingsForms 与临时持久化替身、隔离 Loader 提交算法；不写用户配置。
- [verify-deployment.mjs](checks/verify-deployment.mjs)：将源码复制到 `.runtime/` 检查元数据和注册，不部署 Desktop。
- [verify-link.mjs](checks/verify-link.mjs)：读取本机 profile 的源码链接，不证明模块已重新加载。

## probes：按需探针
- [inspect-desktop.mjs](probes/inspect-desktop.mjs)：只读查看安装归档、Electron fuses 和完整性信息。
- [inspect-route.mjs](probes/inspect-route.mjs)：只读查看 `DSH_PROFILE_DIR` 下特定路由的非密钥字段；输出可能含供应商和模型标识，不要自动上传。
- [extract-runtime.cjs](probes/extract-runtime.cjs)：复制运行时到仓库 `.runtime/`；归档虚拟路径仅 Electron 文件读取支持，普通 Node 需传入解包目录。复制会更新本地隔离运行时，不属于普通验收。
- [test-real-api.mjs](probes/test-real-api.mjs)：显式联网探针，可能计费；要求 `FAILOVER_PROBE_CONFIRM=yes`、`FAILOVER_PROBE_KEY`、`FAILOVER_PROBE_URL`、`FAILOVER_PROBE_MODEL`，不读取密钥库。默认测试从不调用它。

## release：发布门禁
- [sync-readme.mjs](release/sync-readme.mjs)：将根 README 与 LICENSE 同步到插件包。
- [verify-package.mjs](release/verify-package.mjs)：版本、宿主兼容声明、文件白名单和文档字节一致检查。
- [check-staged.mjs](release/check-staged.mjs)：检查暂存路径和常见凭据格式，不输出疑似密钥；启发式扫描不代替人工审阅。

历史 Desktop/核心 apply 工具移至[归档](../archive/rc2/INDEX.md)，当前安装不使用。
