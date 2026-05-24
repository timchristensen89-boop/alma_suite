# Multi-stage build to keep the final image lean
FROM node:24-slim AS builder

WORKDIR /workspace

# Install pnpm
RUN npm install -g pnpm@10.32.1

# Copy workspace manifests first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/db/package.json ./packages/db/package.json
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
COPY apps/stock-api/package.json ./apps/stock-api/

# Install all deps (including dev, needed for build)
RUN pnpm install --frozen-lockfile

# Copy full source
COPY . .

# Generate Prisma client, then build
RUN pnpm db:generate && \
    pnpm --filter @alma/shared build && \
    pnpm --filter @alma/db build && \
    pnpm --filter @alma/api build && \
    pnpm --filter @alma/stock-api build

# Prune dev dependencies
RUN pnpm prune --prod

# Re-generate Prisma client after prune so the generated files live in the
# production-resolved path (typescript peer no longer present).
RUN pnpm --filter @alma/db generate

# ---- runtime image ----
FROM node:24-slim

WORKDIR /workspace

# Copy the pruned workspace (includes regenerated Prisma client)
COPY --from=builder /workspace /workspace

# Cloud Run injects PORT; the API reads it via process.env.PORT
ENV NODE_ENV=production

CMD ["node", "apps/api/dist/apps/api/src/server.js"]
