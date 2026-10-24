# 本机单源开发

唯一源码位于 `C:\Users\Kaczev\Documents\GitHub\dsh-provider-failover`，DSH 安装入口是其中的 `plugin`。原工作区目录已改为指向仓库的 Windows junction，旧路径不会保留另一份可编辑源码。迁移保留了仓库原有的 LICENSE、.gitattributes 和 Git 历史。

## DSH 如何读取更新

本机采用与 KazMode 相同的 `link:` bundle 安装：

```text
link:C:\Users\Kaczev\Documents\GitHub\dsh-provider-failover\plugin
```

插件管理器已应用安装，但 bundle 保持禁用。供应商配置中的 `enabled` 和 `confirmCredentialRecipients` 也保留 false。没有修改 Desktop ASAR；当前宿主缺少请求级 URL 扩展，不能直接启用本插件。

仓库更新后，DSH 的包路径会立即看到同一份文件，不需要复制或重新打 tgz。已加载的 JavaScript 模块仍可能缓存旧代码；修改后重启 DSH，再开始新请求。这里没有另设 watcher，也不承诺热重载。新增依赖或修改 bundle 元数据时，应通过插件管理器重新安装同一个 link，以管理器返回的 applied/nextStep 为准。

核心补丁与插件源码不同：已经应用到某个解包宿主的核心文件是部署产物，仓库更新不会自动改写它们。修改核心补丁后须重新适配、验证并部署；校验失败时不要强行覆盖。Desktop ASAR 的离线部署与回滚仍需另行实现。

## 本地验证

在仓库根目录运行：

```text
npm run verify:link
npm run check
npm run pack:plugin
```

`verify:link` 只读检查当前 profile 下的插件是否真实指向仓库，可在命令末尾传入其他 profile 路径。`check` 使用迁移过来的 `.runtime` 执行本地 HTTP/SSE 测试和安装器校验，不连接付费 API，也不证明 Desktop 已激活。

`.runtime`、安装器 fixture、压缩包和 node_modules 已列入 .gitignore。它们是本机测试缓存或生成产物，不是第二份维护源。从全新克隆运行集成测试前，需要提取同版本运行时，再执行 `node prepare-core.mjs`；仅插件源码不需要构建。旧压缩包保留为历史交付产物，之后分发请重新打包。

卸载时，在 DSH 插件管理器移除 `@kaczev/dsh-provider-line-failover`。卸载不会删除本仓库。当前仓库没有配置 Git remote；本次未推送，也未创建提交。
