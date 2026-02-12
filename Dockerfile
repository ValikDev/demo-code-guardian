# --- Stage 1: Install dependencies ---
FROM node:22-slim AS deps

RUN corepack enable pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/orchestrator/package.json packages/orchestrator/
COPY packages/engine/package.json packages/engine/

RUN pnpm install --frozen-lockfile --prod=false

# --- Stage 2: Build TypeScript ---
FROM deps AS build

COPY tsconfig.base.json tsconfig.json ./
COPY packages/shared/ packages/shared/
COPY packages/orchestrator/ packages/orchestrator/
COPY packages/engine/ packages/engine/

RUN pnpm run build

# --- Stage 3: Production image ---
FROM node:22-slim AS production

# Copy trivy binary from the official image at a pinned version
COPY --from=aquasec/trivy:0.69.1 /usr/local/bin/trivy /usr/local/bin/trivy

# Install git (for cloning repos)
RUN apt-get update && \
    apt-get install -y --no-install-recommends git && \
    rm -rf /var/lib/apt/lists/*

RUN corepack enable pnpm

WORKDIR /app

# Copy dependency manifests and install production-only deps (needs root for global store)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/orchestrator/package.json packages/orchestrator/
COPY packages/engine/package.json packages/engine/

RUN pnpm install --frozen-lockfile --prod

# Copy compiled output only — no .ts source or tsconfig needed at runtime
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/orchestrator/dist packages/orchestrator/dist
COPY --from=build /app/packages/engine/dist packages/engine/dist

# Hand ownership to the non-root node user (uid 1000, ships with node:*-slim)
RUN chown -R node:node /app

USER node

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

# Run compiled JS with strict heap limit for OOM safety
CMD ["node", "--max-old-space-size=150", "packages/orchestrator/dist/server.js"]
