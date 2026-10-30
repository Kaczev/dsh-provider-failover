# 仓库导航

当前发布版本为 0.1.3，目标宿主为 DSH 0.2.1-rc.5。生产代码只在插件目录中；历史补丁不参与安装。

- [README](README.md)：安装、线路策略和安全边界；也是 npm README 的唯一来源。
- [插件导航](plugin/INDEX.md)：宿主、客户端及分发资源。
- [测试导航](tests/INDEX.md)：虚拟时钟、宿主事件、模拟网络和历史路由回归。
- [工具导航](scripts/INDEX.md)：检查命令、只读探针、显式联网探针和发布脚本。
- [开发说明](docs/development.md)：本地运行时依赖、验收和发布流程。
- [设计导航](design/INDEX.md)：当前独立设置页及历史原型。
- [历史 rc2 工具](archive/rc2/INDEX.md)：旧补丁/归档工具，不要用于当前 Desktop。
- [历史核心补丁说明](core/INDEX.md)：rc2 原始快照与修改副本，仅供旧用例。

`.runtime/`、`.desktop-backup/`、`.desktop-candidate/`、`artifacts/` 和 `不入库文件夹/` 均为本机忽略目录，不进入 Git 或 npm。不要将运行时、凭据、日志、安装归档或用户配置加入发布包。
