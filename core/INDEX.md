# 历史核心快照

此目录保存 DSH 0.2.1-rc.2 的原始与修改后文件，供旧路由回归和历史补丁工具引用。当前插件通过内存包装运行，不会加载或部署这些快照。

- [manifest.json](manifest.json)：三个 rc2 文件的原始/补丁 SHA-256。
- `original/`：对应原始文件。
- `patched/`：旧 request-base-url、重试和供应商编辑区挂点修改。

当前宿主为 rc3，不要将这些文件覆盖到安装目录。旧工具的风险见[归档说明](../archive/rc2/INDEX.md)。
