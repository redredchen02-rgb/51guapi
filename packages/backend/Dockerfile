FROM node:20-slim AS builder
RUN apt-get update && apt-get install -y python3 make g++ git && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY . .

# backend image 不需要 extension;--ignore-scripts 跳过其 wxt prepare postinstall
# (该 postinstall 依赖 shared dist,安装阶段尚未 build,会污染安装状态)。
# better-sqlite3 原生编译被 --ignore-scripts 跳过,随后显式 rebuild。
RUN git init && npm install -g pnpm@9 && pnpm install --frozen-lockfile --ignore-scripts && pnpm rebuild better-sqlite3

# composite 增量编译:清 buildinfo 强制 emit,避免「认为已最新」跳过产出 dist。
RUN rm -f packages/shared/tsconfig.tsbuildinfo && pnpm --filter @51guapi/shared build
RUN pnpm --filter 51guapi-backend build

FROM node:20-slim
WORKDIR /app

COPY --from=builder /app/packages/backend/dist ./dist
COPY --from=builder /app/packages/backend/package.json ./package.json
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production
EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3002/api/v1/healthz || exit 1

CMD ["node", "dist/index.js"]
