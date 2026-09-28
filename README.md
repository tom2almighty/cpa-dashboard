# CPA Dashboard

[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)（CPA 8.0+）的管理面板，基于 Management API v8 接口构建。支持作为 CPA 内置页面运行，或作为前后端分离的静态站点独立部署。

## 部署方式

### 方式一：CPA 内置托管

在 CPA 的 `config.yaml` 中配置管理面板仓库，CPA 会自动下载并托管面板页面：

```yaml
config-version: 8

management:
  secret-key: "你的管理密钥"
  panel-github-repository: "https://github.com/tom2almighty/cpa-dashboard"
```

访问 `http://<CPA 地址>/management.html` 即可使用。

亦可从 [Releases](https://github.com/tom2almighty/cpa-dashboard/releases) 下载编译产物 `management.html`，放入 CPA 的静态文件目录（或 `MANAGEMENT_STATIC_PATH`）。

### 方式二：独立静态站点部署

面板为纯前端单文件架构，可直接部署在任意静态托管平台（Vercel、Cloudflare Pages、Nginx 等）。

1. 部署打包产物（`dist/management.html` 重命名为 `index.html`）。
2. 在 CPA 服务端设置环境变量 `MANAGEMENT_PASSWORD=你的访问密码`。
3. 打开前端页面，在登录界面填写 CPA 远程服务地址及访问密码即可连接。

## 本地开发

本项目使用 [Bun](https://bun.sh)。

```bash
bun install
bun run dev
```

开发服务器启动后访问 `http://localhost:5173`。

可选环境变量：
- `CPA_URL`：指定本地开发反向代理的后端 CPA 地址，例如 `CPA_URL=http://127.0.0.1:8317 bun run dev`。

## 构建与校验

```bash
bun run check     # Biome 检查与 TypeScript 类型校验
bun run test      # 运行测试用例
bun run build     # 编译生成单文件 dist/management.html
```

## 致谢

[LINUX DO](https://linux.do/)

## LICENSE

[AGPL-3.0](LICENSE)