# CHOG World backend. Build from the repo root:
#   docker build -f apps/backend/Dockerfile -t chogworld-backend .
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.30.1 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
RUN pnpm install --frozen-lockfile --filter @chog-world/backend...
COPY packages/shared packages/shared
COPY apps/backend apps/backend
COPY contracts/deployments contracts/deployments
RUN pnpm --filter @chog-world/shared build && pnpm --filter @chog-world/backend build
# A self-contained production copy: dist, migrations and production dependencies only.
RUN pnpm --filter @chog-world/backend deploy --prod --legacy /out

FROM node:24-slim
# Fonts for the Chog image overlays (Liberation Sans is metric-compatible with Arial).
RUN apt-get update && apt-get install -y --no-install-recommends fonts-liberation fontconfig ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out .
ENV NODE_ENV=production \
    ART_CACHE_PATH=/tmp/chog-base.png
USER node
CMD ["node", "dist/main.js"]
