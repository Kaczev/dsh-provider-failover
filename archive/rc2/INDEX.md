# 历史 rc2 工具

这里保存 DSH 0.2.1-rc.2 阶段的研究工具。**当前 0.0.1 插件不依赖核心补丁，不要执行这些工具来安装当前插件，更不要对正在使用的 Desktop apply。** 整理时仅调整目录及资源根路径，没有运行归档部署工具。

- [prepare-core.mjs](prepare-core.mjs)：为隔离 rc2 运行时生成旧核心补丁并写入隔离副本。
- [install-core.mjs](install-core.mjs)：校验/应用/恢复解包 rc2 核心文件；拒绝 ASAR。
- [prepare-desktop.mjs](prepare-desktop.mjs)：旧 Desktop 候选归档生成器。
- [deploy-desktop.ps1](deploy-desktop.ps1)：旧 ASAR 替换工具，含 apply/restore；有真实安装写入副作用。
- [verify-desktop.cjs](verify-desktop.cjs)：旧候选归档只读校验。
- [package-delivery.mjs](package-delivery.mjs)：旧 0.1.0 ZIP 打包记录，清单引用旧根布局，不作为可运行发布入口。
- [test-results.txt](test-results.txt)：历史 17 项回归输出，不是当前版本验收结果。

核心快照见[核心说明](../../core/INDEX.md)。当前命令见[开发说明](../../docs/development.md)。
