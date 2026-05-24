FROM node:24-slim

# Prisma needs OpenSSL for its query engine binary
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Install pnpm
RUN npm install -g pnpm@10.32.1

# Copy ALL workspace manifests first (layer cache for the install step)
# We need ALL packages so pnpm creates correct node_modules symlinks for each
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ ./packages/
COPY apps/api/package.json ./apps/api/
COPY apps/stock-api/package.json ./apps/stock-api/

# Stub package.json for the other frontend apps so pnpm resolves the full workspace
# (avoids partial installs that leave apps/api/node_modules incomplete)
RUN for d in admin-web comms-web giftcards-web marketing-web reports-web \
      reserve-web staff-web stock-web web venue-ipad-dashboard; do \
      mkdir -p apps/$d && \
      echo "{\"name\":\"@alma/$d\",\"version\":\"0.0.0\",\"private\":true}" \
        > apps/$d/package.json; \
    done

# Install dependencies (including dev — needed for TypeScript build)
RUN pnpm install --frozen-lockfile

# Copy full source (overwrites the stubs above; node_modules already set up)
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
