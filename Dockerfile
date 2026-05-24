FROM node:24-slim

# Prisma needs OpenSSL for its query engine binary
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Install pnpm
RUN npm install -g pnpm@10.32.1

# Copy full source (node_modules is gitignored and not uploaded)
COPY . .

# Install all deps (including dev — needed for TypeScript build)
RUN pnpm install --frozen-lockfile

# Generate Prisma client and compile all server packages
RUN pnpm db:generate && \
    pnpm --filter @alma/shared build && \
    pnpm --filter @alma/db build && \
    pnpm --filter @alma/api build && \
    pnpm --filter @alma/stock-api build

# Prune dev dependencies (CI=true skips TTY confirmation prompt)
RUN CI=true pnpm prune --prod

# Re-generate Prisma client after prune so the generated files live in the
# production peer-resolution path (typescript devDep may have been removed)
RUN pnpm --filter @alma/db generate

ENV NODE_ENV=production

CMD ["node", "apps/api/dist/apps/api/src/server.js"]
