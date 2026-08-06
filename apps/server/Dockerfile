# Сервер «Гавани». Нужен постоянный процесс: по WebSocket идут тики (§1 ТЗ),
# поэтому serverless-платформы не подходят — только Fly.io, Railway и подобные.

FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable

# Сначала манифесты — тогда слой с зависимостями переживает правку кода.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @gavan/server...

COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @gavan/server build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --prod --filter @gavan/server...

COPY --from=build /app/apps/server/dist apps/server/dist
COPY apps/server/drizzle apps/server/drizzle

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

# Проверка живости: тот же адрес, что использует платформа.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "apps/server/dist/index.js"]
