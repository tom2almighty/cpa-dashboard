# CPA Dashboard

[简体中文](README.md)

## Overview

A web management panel for CLIProxyAPI 8.x, covering auth files, OAuth, providers, client API keys, models, plugins, logs and v8 configuration. The build output is a single `management.html` that can be hosted by CPA or deployed as a standalone static site.

The credential page shows renewal and recovery status, supports same-account Codex sign-in, and offers manual inference verification (which consumes a small amount of quota). Successful login or inference does not verify automatic renewal.

## Development

Requires Node.js 24+ and pnpm 12.10.1 (declared in `package.json` under `packageManager`).

```bash
pnpm install
pnpm run dev
```

The dev server runs at `http://localhost:5173`. To proxy requests to a local CPA:

```bash
CPA_URL=http://127.0.0.1:8317 pnpm run dev
```

## Build and deployment

```bash
pnpm run check     # Biome + TypeScript
pnpm run test      # Unit tests
pnpm run build     # Produces dist/management.html
```

### Hosted by CPA

Point CPA at the panel repository in `config.yaml`; CPA downloads `management.html` from the latest release:

```yaml
config-version: 8

management:
  secret-key: "your-management-key"
  panel-github-repository: "https://github.com/tom2almighty/cpa-dashboard"
```

Open `http://<cpa-host>/management.html`. You can also download `management.html` from Releases and place it in CPA's static directory (or `MANAGEMENT_STATIC_PATH`).

### Standalone static site

1. Rename `dist/management.html` to `index.html` and deploy it to any static host.
2. Set `MANAGEMENT_PASSWORD` on the CPA server.
3. Open the page and enter the CPA address and management key.

The single-file build is roughly 1.8MB uncompressed (about 580KB gzipped). When CPA hosts the panel itself, it compresses downstream responses (including static files and SSE) according to `server.response-compression`; standalone static hosting still needs gzip or brotli at the hosting layer.

## License

[AGPL-3.0](LICENSE)
