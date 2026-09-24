# 前端和后端都打包成与平台无关的 JS,构建阶段固定在构建机平台上跑
FROM --platform=$BUILDPLATFORM oven/bun:1-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build && bun run build:server

FROM oven/bun:1-alpine
WORKDIR /app
ENV PORT=8318 \
    DATA_DIR=/data \
    STATIC_DIR=./dist
COPY --from=build /app/dist ./dist
COPY --from=build /app/build/server.js ./server.js
EXPOSE 8318
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8318/healthz || exit 1
CMD ["bun", "server.js"]
