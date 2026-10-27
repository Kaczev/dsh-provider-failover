# 插件导航

此目录是 npm 包的根目录，也是本机源码链接安装目标。不要移动此目录，以免破坏现有链接。

- [index.js](index.js)：HTTPS 地址校验、volatile Config、宿主事件接线；另保留历史路由导出供回归。
- [transport.js](transport.js)：可逆适配器包装、线路冷却、同轮粘滞、明确 server_error 归类及流式保护。
- [client.js](client.js)：独立设置页、两个可留空地址框、读取/保存与冲突处理。
- [package.json](package.json)：npm 元数据、精确宿主版本、客户端注入及分发白名单。
- [cordis.patch.yml](cordis.patch.yml)：插入插件行，默认地址表为空。
- [中文元数据](locale/zh-CN.json)、[英文元数据](locale/en.json)、[图标](icon.svg)：插件管理器展示资源。
- [README](README.md)、[许可证](LICENSE)：由根目录同步，勿在此单独编辑。
