FROM node:24-slim

# Prisma needs OpenSSL for its query engine binary at runtime
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

RUN npm install -g pnpm@10.32.1

# Copy full source (node_modules is gitignored and not in the build context)
COPY . .

# Install all deps (including dev — needed for build AND for Prisma peer resolution)
# We intentionally do NOT prune devDeps: pnpm's prune invalidates the @prisma/client
# typescript peer-dep hash, removing the generated client symlinks before startup.
RUN pnpm install --frozen-lockfile

# Generate Prisma client and compile all server packages.
#
# The heap bump is for @alma/api's tsc only, and it is not optional: Node
# sizes its old space from the container's memory and lands near 1GB here,
# while type-checking the API against the generated Prisma client peaks
# somewhere between 1 and 1.4GB. Without this the build dies with
# "Ineffective mark-compacts near heap limit" and exit 134, which reads like
# a broken image but is just the type-checker running out of room. It is set
# on this RUN only, so the running container keeps Node's own default.
RUN export NODE_OPTIONS=--max-old-space-size=3072 && \
    pnpm db:generate && \
    pnpm --filter @alma/shared build && \
    pnpm --filter @alma/db build && \
    pnpm --filter @alma/api build && \
    pnpm --filter @alma/stock-api build

ENV NODE_ENV=production

CMD ["node", "apps/api/dist/apps/api/src/server.js"]
