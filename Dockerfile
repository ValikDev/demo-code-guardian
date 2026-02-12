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

# Install git (for cloning repos) and trivy (for scanning)
RUN apt-get update && \
    apt-get install -y --no-install-recommends git curl && \
    curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin && \
    apt-get remove -y curl && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

RUN corepack enable pnpm

WORKDIR /app

# Copy dependency manifests and install production-only deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/orchestrator/package.json packages/orchestrator/
COPY packages/engine/package.json packages/engine/

RUN pnpm install --frozen-lockfile --prod

# Copy compiled output only — no .ts source or tsconfig needed at runtime
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/orchestrator/dist packages/orchestrator/dist
COPY --from=build /app/packages/engine/dist packages/engine/dist

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

# Run compiled JS with strict heap limit for OOM safety
CMD ["node", "--max-old-space-size=150", "packages/orchestrator/dist/server.js"]
