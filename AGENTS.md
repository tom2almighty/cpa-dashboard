# AGENTS.md

## 项目概述
本仓库是 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)（简称 CPA）的管理面板。
- 基于 CPA 8.0 全新推出的 **Management API v8** 规范进行构建与通信（基础路由：`/v8/management`）。
- 面板专为 CPA 8.0 / v8 配置体系设计，**不向后兼容 `/v0/management`**。
- 文档在线地址：https://help.router-for.me/ （v8 API 文档：`/management/apiv8`，v8 配置选项：`/configuration/options`）
- 文档仓库：https://github.com/router-for-me/CLIProxyAPIDocs
- 官方面板仓库参考：https://github.com/router-for-me/Cli-Proxy-API-Management-Center

## 技术栈与工程规范
- **开发与构建**：Bun + Vite + React 19 + TypeScript + Tailwind CSS
- **代码规范与格式化**：Biome 统一格式化与代码检查（遵循规范严格缩进与规则）
- **组件与交互**：
  - 采用标准 ShadcnUI 风格和主题 CSS 变量（Token 驱动，支持深浅色模式），圆角与间距保持原生体系（`rounded-md`/`rounded-lg`），禁止大面积阴影与模板化卡片边框。
  - 图标使用 Lucide React 与 SVG，严禁表情符号充当图标。
  - 响应式设计完备（全面覆盖移动端到桌面端断点），无障碍语义完整（ARIA 属性、Tab 键盘导航、焦点可达）。
  - 长列表统一提供合理的分页（Pagination）或轻量定位机制，避免页面过长与冗余重绘。

## 架构与核心规范（API v8）
1. **API 前缀与请求约定**：
   - 管理端点统一使用 `/v8/management/*`。
   - 所有已认证的写入请求直接发送目标值或结构，不得使用旧版的 `{ "value": ... }` 包装；PUT 整体替换节点，PATCH 做深度合并。
   - 客户端 API 密钥统一使用 `/v8/management/config/access/api-keys`（`access.api-keys`），区分于上游服务提供商分组 `api-keys.<provider>`。
2. **凭据管理**：
   - OAuth 与认证文件通过 `/v8/management/credentials*` 接口统一操作（包括列出、上传、删除、下载与状态更新）。
   - 冷却状态与重置走 `/v8/management/routing/cooldown/reset`，静态模型目录走 `/v8/management/routing/model-definitions/:channel`。
3. **插件管理**：
   - 插件列表、商店与安装统一走 `/v8/management/plugins*`；插件个性化配置走 `/v8/management/config/plugins/configs/<id>`。
4. **设计理念**：
   - 遵循 KISS、YAGNI 与 Fail-Fast，纯原生实现，简洁高效，坚决移除废弃代码与冗余兼容垫片。
