# Boule API 镜像（U1：先支持跑迁移；U6 起承载 Fastify 服务）。
# 多阶段：先装 workspace 依赖，再带源码。Node 22+ 原生 strip-types 跑 .ts。
# liteparse 只发布 glibc 原生包（linux-*-gnu），且当前 arm64 二进制需要 GLIBC_2.38+；
# 使用 Debian trixie slim，不能使用 Alpine/musl 或 bookworm slim。
FROM node:22-trixie-slim AS base
RUN corepack enable
WORKDIR /repo

ARG TESSDATA_COMMIT=87416418657359cb625c412a48b6e1d6d41c29bd
ENV TESSDATA_PREFIX=/opt/tessdata
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p "$TESSDATA_PREFIX" \
  && curl -fsSLo "$TESSDATA_PREFIX/chi_sim.traineddata" "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${TESSDATA_COMMIT}/chi_sim.traineddata" \
  && curl -fsSLo "$TESSDATA_PREFIX/eng.traineddata" "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${TESSDATA_COMMIT}/eng.traineddata" \
  && printf '%s  %s\n%s  %s\n' \
    'a5fcb6f0db1e1d6d8522f39db4e848f05984669172e584e8d76b6b3141e1f730' "$TESSDATA_PREFIX/chi_sim.traineddata" \
    '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2' "$TESSDATA_PREFIX/eng.traineddata" \
    | sha256sum -c -

# workspace 清单（利用层缓存）
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile

# 源码
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

WORKDIR /repo/apps/api
# 默认命令由 compose 覆盖（U1=迁移，U6=启动服务）
CMD ["pnpm", "db:migrate"]
