# Boule API 镜像（U1：先支持跑迁移；U6 起承载 Fastify 服务）。
# 多阶段：先装 workspace 依赖，再带源码。Node 22+ 原生 strip-types 跑 .ts。
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

# workspace 清单（利用层缓存）
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile=false

# 源码
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

WORKDIR /repo/apps/api
# 默认命令由 compose 覆盖（U1=迁移，U6=启动服务）
CMD ["pnpm", "db:migrate"]
