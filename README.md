# CPA Dashboard

[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)（CPA）的管理面板。用 SQLite 持久化保存用量，CPA 重启后数据不会丢失。

- 用量统计：概览、趋势图，以及按模型、账号、API Key、提供商分组的统计和请求明细
- 费用估算：启动时自动从 [LiteLLM](https://github.com/BerriAI/litellm) 同步模型价格，之后每天刷新
- CPA 管理：账号（认证文件）的启用、停用、上传、删除，在线编辑 `config.yaml`

## CPA 配置要求

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

## 部署

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
cp .env.example .env   # CPA_URL 改成本机可访问的地址
bun run dev:server     # 后端，默认端口 8318
bun run dev            # 前端，Vite 会把 /api 和 /v0 代理到后端
```

检查与构建：

```bash
bun run check          # biome + tsc
bun run build          # 前端
bun run build:server   # 后端打包成 build/server.js
```

发布：推送 `vX.Y.Z` 标签后，GitHub Actions 会构建 amd64 和 arm64 镜像推送到 GHCR，并生成 Release。
