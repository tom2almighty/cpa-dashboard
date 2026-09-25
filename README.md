# CPA Dashboard

[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)（CPA）的高颜值纯前端单文件管理面板，完整覆盖 CPA `/v0/management` 管理接口。无需后端容器或数据库，直接由 CPA 提供或任意静态服务器托管。

## 特性

- **网关接入**：
  - **账号**：认证文件上传、启停、下载、删除、重置冷却、查看可用模型，Vertex 服务账号导入；实时查询 Codex、Claude、Antigravity、Kimi、xAI 等账号的 5 小时、每周、每月额度（剩余额度直观可视化）
  - **OAuth 登录**：Codex、Claude、Antigravity、xAI、Devin、Kimi（国内版）、Kimi.ai（国际版）、Meta 等，支持网页授权与设备码，远程部署时可直接粘贴回调地址完成认证
  - **提供商**：Gemini、Claude、Codex、xAI、Meta、Vertex、Interactions 及 OpenAI 兼容的 API Key 管理与近期请求量
  - **API Key**：客户端调用 `/v1` 接口所需的密钥管理与快速接入指南
- **模型服务**：
  - **模型管理**：查看 `/v1/models` 对外提供的模型并一键复制模型名；配置渠道模型别名与排除规则；查看内置模型定义
- **系统运维**：
  - **插件**：插件启停、参数配置、删除，卡片式插件商店与安全风险二次确认安装
  - **日志**：实时查看与筛选 CPA 运行日志，按请求 ID 下载请求日志与错误日志
  - **系统配置**：全量参数可视化配置（路由策略、会话粘性、重试与冷却、模式切换等）；**Payload 规则可视化编辑器**（缺省注入、强制覆盖、字段过滤）；`config.yaml` 在线源文件编辑
- **版本与更新**：实时显示面板版本与 CPA 运行版本，一键比对并检查最新版本

## 快速使用

在 CPA 的 `config.yaml` 中配置管理面板指向本仓库，CPA 会自动下载最新 Release 里的 `management.html`：

```yaml
remote-management:
  secret-key: "你的管理密钥"
  panel-github-repository: "https://github.com/tom2almighty/cpa-dashboard"
```

重启或热加载 CPA 后，打开：

```
http://<CPA 地址>:8317/management.html
```

输入管理密钥登录即可使用。密钥保存在当前标签页，勾选「在这台设备上记住密钥」后可持久化保存在浏览器本地。

### 手动下载部署

你也可以直接从本仓库的 [Releases](https://github.com/tom2almighty/cpa-dashboard/releases) 页面下载编译好的 `management.html`，放置在 CPA 的 `static/` 目录或环境变量 `MANAGEMENT_STATIC_PATH` 指定的路径下。

## 本地开发与构建

需要 [Bun](https://bun.sh)。

```bash
bun install
bun run dev             # 启动 Vite 开发服务器，/v0 和 /v1 会自动代理到 CPA（默认 http://localhost:8317）
```

环境变量：
- `CPA_URL`：指定本地开发时代理的 CPA 服务地址，例如 `CPA_URL=http://127.0.0.1:8317 bun run dev`

### 检查与构建

```bash
bun run check           # 代码规范与 TypeScript 类型检查
bun run test            # 单元测试
bun run build           # 编译生成单文件 dist/management.html
bun run build:lite      # 生成 dist-lite/management.html
```

推送 `v*` 标签后，GitHub Actions 会自动构建并创建 Release，发布单文件 `management.html` 资产。
