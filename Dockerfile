# syntax=docker/dockerfile:1
# cc-desk 远程控制中继服务镜像。
# 单进程同时承担：①托管 PWA 静态资源 ②WebSocket 消息转发（/pair 配对、/ws 转发）。
# 不依赖 electron / node-pty / tiptap，纯 Node 运行。
#
# 设计要点：根 package.json 是桌面端 Electron 项目（含 node-pty/electron/patches），
# 中继运行只需 ws，构建只需 typescript + vite。故 Dockerfile 不跑根 pnpm install，
# 只装构建工具 + web 子项目依赖，避免拖入桌面端重依赖。
#
# 构建：docker build -t cc-relay .
# 运行：docker run -d --name cc-relay -p <宿主端口>:8080 -v cc-relay-data:/app/data cc-relay

# ---------- 阶段1：构建 PWA + 编译中继 TS ----------
FROM node:20-alpine AS builder
WORKDIR /build

# 装构建工具：typescript 编译中继/web；@types/node+@types/ws 给 tsc 类型检查用（不进运行时）
RUN npm install -g typescript vite && \
    npm init -y >/dev/null && npm install --no-audit --no-fund --save-dev @types/node@22 @types/ws@8

# 拷源码（.dockerignore 已排除 node_modules/out/dist/docs/tests 等）
COPY . .

# 1) 构建 PWA：web 子项目独立装依赖 + 构建 → relay/public
RUN cd web && npm install --no-audit --no-fund && npm run build

# 2) 编译中继 TS → dist（CJS），只需 typescript，无需根依赖
RUN tsc -p tsconfig.relay.json

# 验证产物
RUN ls dist/relay/main.js relay/public/index.html

# ---------- 阶段2：运行时（极简） ----------
FROM node:20-alpine AS runtime
WORKDIR /app

# 运行时只需 ws 一个外部依赖
RUN npm init -y >/dev/null && npm install --no-audit --no-fund ws@8

# 复制编译后的中继 + PWA 静态资源
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/relay/public ./public

# 数据持久化目录（keys.json + bindings.json）
RUN mkdir -p /app/data
VOLUME /app/data

ENV RELAY_PORT=8080
ENV RELAY_DATA_DIR=/app/data
ENV RELAY_STATIC_DIR=/app/public

EXPOSE 8080

CMD ["node", "dist/relay/main.js"]
