# syntax=docker/dockerfile:1.7
# Build context: repository root.   docker build -f docker/web.Dockerfile .

ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@12.3.4 --activate
WORKDIR /repo

# ---- install + build ---------------------------------------------------------
FROM base AS build
# API_URL is compiled into the /api rewrite (only used when no reverse proxy fronts the app).
ARG API_URL=http://localhost:4000
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV API_URL=${API_URL} NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/split-engine/package.json packages/split-engine/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @billsplit/web...
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY packages/split-engine packages/split-engine
COPY apps/web apps/web
RUN pnpm --filter @billsplit/web... build

# ---- runtime -------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
ARG APP_VERSION=dev
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1 APP_VERSION=${APP_VERSION}
WORKDIR /app
# Next.js standalone output keeps the monorepo layout: server.js lives at apps/web/.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
