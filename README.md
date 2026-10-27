# CPA Dashboard

[English](README.en.md)

## 项目简介

CLIProxyAPI 8.x 的 Web 管理面板，覆盖认证文件、OAuth、提供商、客户端密钥、模型、插件、日志与 v8 配置管理。构建产物为单个 `management.html`，既可交给 CPA 内置托管，也可作为独立静态站点部署。

## 开发环境配置

依赖 Node.js 24+ 与 pnpm 12.10.1（版本记录在 `package.json` 的 `packageManager` 字段）。

```bash
pnpm install
pnpm run dev
```

开发服务器默认运行在 `http://localhost:5173`。需要代理到本地 CPA 时：

```bash
CPA_URL=http://127.0.0.1:8317 pnpm run dev
```

## 构建与部署

```bash
pnpm run check     # Biome + TypeScript
pnpm run test      # 单元测试
pnpm run build     # 生成 dist/management.html
```

### CPA 内置托管

在 CPA 的 `config.yaml` 中配置面板仓库，CPA 会自动下载 Release 中的 `management.html`：

```yaml
config-version: 8

management:
  secret-key: "你的管理密钥"
  panel-github-repository: "https://github.com/tom2almighty/cpa-dashboard"
```

访问 `http://<CPA 地址>/management.html`。也可以从 Releases 下载 `management.html`，放入 CPA 的静态文件目录（或 `MANAGEMENT_STATIC_PATH`）。

### 独立静态站点

1. 将 `dist/management.html` 重命名为 `index.html` 并部署到任意静态托管平台。
2. 在 CPA 服务端设置环境变量 `MANAGEMENT_PASSWORD`。
3. 打开页面，在登录界面填写 CPA 地址与管理密钥。

构建结果是未压缩的单文件，约 1.8MB（gzip 后约 580KB）。交给 CPA 内置托管时，CPA 默认按 `server.response-compression` 配置压缩下游响应（含静态文件与 SSE）；独立静态站点部署时仍需在托管层开启 gzip 或 brotli。

## 开源许可证

[AGPL-3.0](LICENSE)
