# syntax=docker/dockerfile:1.7
# Build context: repository root.   docker build -f docker/worker.Dockerfile .

ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@12.3.4 --activate
WORKDIR /repo

# ---- install + build ---------------------------------------------------------
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/ocr/package.json packages/ocr/
COPY packages/queue/package.json packages/queue/
COPY packages/storage/package.json packages/storage/
COPY apps/worker/package.json apps/worker/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @billsplit/worker...
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY packages/db packages/db
COPY packages/ocr packages/ocr
COPY packages/queue packages/queue
COPY packages/storage packages/storage
COPY apps/worker apps/worker
RUN pnpm --filter @billsplit/worker... build
# Pruned production bundle (runtime deps only, workspace deps copied in).
RUN pnpm --filter @billsplit/worker --prod --legacy deploy /out

# ---- runtime -------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
ARG APP_VERSION=dev
ENV NODE_ENV=production APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
CMD ["node", "dist/main.js"]
