FROM node:24-slim

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

RUN npm install -g pnpm@10.32.1

COPY . .

RUN pnpm install --frozen-lockfile

RUN pnpm db:generate && \
    pnpm --filter @alma/shared build && \
    pnpm --filter @alma/db build && \
    pnpm --filter @alma/api build && \
    pnpm --filter @alma/stock-api build

RUN CI=true pnpm prune --prod

RUN pnpm --filter @alma/db generate

# Debug: show @prisma resolution paths
RUN echo "=== apps/api/node_modules/@prisma ===" && \
    ls -la apps/api/node_modules/@prisma 2>/dev/null || echo "NOT FOUND" && \
    echo "=== node_modules/@prisma ===" && \
    ls -la node_modules/@prisma 2>/dev/null || echo "NOT FOUND" && \
    echo "=== @prisma/client target ===" && \
    ls apps/api/node_modules/@prisma/client/package.json 2>/dev/null || echo "TARGET MISSING"

ENV NODE_ENV=production

CMD ["node", "apps/api/dist/apps/api/src/server.js"]
