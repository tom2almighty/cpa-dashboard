# CPA Dashboard

[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)（CPA）的纯前端单文件管理面板，完整覆盖 CPA `/v0/management` 管理接口。


## 快速使用

在 CPA 的 `config.yaml` 中配置管理面板指向本仓库，CPA 会自动下载最新 Release 里的 `management.html`：

```yaml
remote-management:
  secret-key: "你的管理密钥"
  panel-github-repository: "https://github.com/tom2almighty/cpa-dashboard"
```

重启或热加载 CPA 后，打开：

```
http://<CPA 地址>/management.html
```

### 手动下载部署

你也可以直接从本仓库的 [Releases](https://github.com/tom2almighty/cpa-dashboard/releases) 页面下载编译好的 `management.html`，放置在 CPA 的 `static/` 目录或环境变量 `MANAGEMENT_STATIC_PATH` 指定的路径下。

## 本地开发与构建

需要 [Bun](https://bun.sh)。

```bash
bun install
bun run dev
```

开发服务器启动后访问 `http://localhost:5173/management.html`。

环境变量：
- `CPA_URL`：指定本地开发时代理的 CPA 服务地址，例如 `CPA_URL=http://127.0.0.1:8317 bun run dev`

### 检查与构建

```bash
bun run check           # 代码规范与 TypeScript 类型检查
bun run test            # 单元测试
bun run build           # 编译生成单文件 dist/management.html
```

推送 `v*` 标签后，GitHub Actions 会自动构建并创建 Release，发布单文件 `management.html` 资产。
