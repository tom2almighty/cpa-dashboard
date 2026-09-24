# CPA Dashboard

[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)（CPA）的管理面板，覆盖 CPA 全部 `/v0/management` 管理接口。提供两个版本：

| | 完整版 | 精简版 |
| --- | --- | --- |
| 部署方式 | Docker，和 CPA 一起部署 | 由 CPA 自己提供页面，不需要额外部署 |
| 用量统计 | SQLite 持久化，CPA 重启不丢失；按模型、账号、API Key 统计，估算费用 | 不保存用量，只显示 CPA 运行时的近 200 分钟请求 |
| CPA 管理 | 全部支持 | 全部支持 |

两个版本都支持的管理功能：

- 账号：认证文件的上传、启停、下载、删除、编辑属性、重置冷却、查看可用模型，Vertex 服务账号导入；查询 Codex、Claude、Antigravity、Kimi、xAI 账号的 5 小时、每周、每月额度
- OAuth 登录：Codex、Claude、Antigravity、xAI、Devin、Kimi、Muse，CPA 部署在远程时可粘贴回调地址完成登录
- 提供商：Gemini、Claude、Codex、OpenAI 兼容、Vertex、xAI、Interactions 的 API Key 配置和近期请求量
- 模型：OAuth 渠道的模型别名、排除规则，CPA 内置模型目录
- 插件：启停、配置、删除、插件页面、插件商店安装
- 日志：运行日志实时查看和筛选，按请求 ID 下载请求日志，失败请求日志下载
- 配置：常用设置图形化修改，客户端 API Key 管理，`config.yaml` 在线编辑

## 精简版

在 CPA 的 `config.yaml` 中把管理面板指向本仓库，CPA 会自动下载最新 Release 里的 `management.html`：

```yaml
remote-management:
  secret-key: "你的管理密钥"
  panel-github-repository: "https://github.com/tom2almighty/cpa-dashboard"
```

重启或热加载 CPA 后打开 `http://<CPA 地址>:8317/management.html`，用管理密钥登录。密钥默认只保存在当前标签页，勾选「记住密钥」后才会存到浏览器本地。

## 完整版

### CPA 配置要求

在 CPA 的 `config.yaml` 中设置：

```yaml
usage-statistics-enabled: true
# 用量队列的保留时间，面板停机超过这个时间，期间的记录会丢失，最大 3600
redis-usage-queue-retention-seconds: 3600
remote-management:
  # 面板和 CPA 在不同容器里，必须允许非本机访问
  allow-remote: true
  secret-key: "你的管理密钥"
```

说明：

- 面板通过 `GET /v0/management/usage-queue` 拉取用量，拉取后记录会从队列中删除。请确保只有本面板在消费这个队列，不要同时运行其他用量采集工具。
- CPA 启动时会把明文的 `secret-key` 替换成 bcrypt 哈希，所以面板的 `CPA_MANAGEMENT_KEY` 要填设置时的原文。

### 部署

1. 复制 `.env.example` 为 `.env`，填入 `CPA_URL` 和 `CPA_MANAGEMENT_KEY`
2. 参考 `docker-compose.yml`，把面板和 CPA 放在同一个 compose 里，通过服务名互相访问
3. 启动：

```bash
docker compose up -d
```

打开 `http://<主机>:8318`，用 CPA 的管理密钥登录。数据保存在 `./data/dashboard.sqlite`。

环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CPA_URL` | 无，必填 | CPA 地址，例如 `http://cli-proxy-api:8317` |
| `CPA_MANAGEMENT_KEY` | 无，必填 | CPA 管理密钥原文，同时也是面板的登录密钥 |
| `PORT` | `8318` | 监听端口 |
| `DATA_DIR` | `/data` | SQLite 数据目录 |
| `POLL_INTERVAL_MS` | `3000` | 用量队列拉取间隔（毫秒） |
| `PRICE_SYNC_HOURS` | `24` | 价格同步间隔（小时） |
| `LITELLM_PRICES_URL` | LiteLLM 官方价格表 | 价格表地址，网络受限时可换成镜像地址 |

## 开发

需要 [Bun](https://bun.sh)。

```bash
bun install
cp .env.example .env         # CPA_URL 改成本机可访问的地址
bun run dev:server           # 完整版后端，默认端口 8318
bun run dev                  # 完整版前端，Vite 会把 /api 和 /v0 代理到后端
bunx vite --mode lite        # 精简版前端，/v0 直接代理到 CPA_URL（默认 http://localhost:8317）
```

检查与构建：

```bash
bun run check          # biome + tsc
bun run test           # 单元测试
bun run build          # 完整版前端
bun run build:server   # 完整版后端，打包成 build/server.js
bun run build:lite     # 精简版，生成 dist-lite/management.html
```

发布：推送 `vX.Y.Z` 标签后，GitHub Actions 会构建 amd64 和 arm64 镜像推送到 GHCR，并创建 Release、附带精简版的 `management.html`。
