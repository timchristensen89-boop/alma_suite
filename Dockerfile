FROM node:24-slim

# Prisma needs OpenSSL for its query engine binary
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Install pnpm
RUN npm install -g pnpm@10.32.1

# Copy workspace manifests first (layer cache for the install step)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/db/package.json ./packages/db/package.json
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
COPY apps/stock-api/package.json ./apps/stock-api/

# Install dependencies (including dev — needed for TypeScript build)
RUN pnpm install --frozen-lockfile

# Copy full source (node_modules is gitignored and not included)
COPY . .

# Generate Prisma client, then compile all packages
RUN pnpm db:generate && \
    pnpm --filter @alma/shared build && \
    pnpm --filter @alma/db build && \
    pnpm --filter @alma/api build && \
    pnpm --filter @alma/stock-api build

# Prune dev dependencies (CI=true skips TTY confirmation prompt)
RUN CI=true pnpm prune --prod

# Re-generate Prisma client after prune so the generated files live in the
# production-resolved peer path (typescript peer may have been removed above)
RUN pnpm --filter @alma/db generate

ENV NODE_ENV=production

CMD ["node", "apps/api/dist/apps/api/src/server.js"]
