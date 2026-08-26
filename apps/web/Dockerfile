# Stage 1: Build stage
FROM node:24-alpine AS builder

WORKDIR /app

# Enable Corepack and prepare pinned pnpm version
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

# Copy workspace configuration and all package manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/domain/package.json ./packages/domain/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/application/package.json ./packages/application/
COPY packages/infrastructure/package.json ./packages/infrastructure/
COPY apps/control-api/package.json ./apps/control-api/
COPY apps/render-worker/package.json ./apps/render-worker/
COPY apps/web/package.json ./apps/web/

# Install dependencies using frozen lockfile
RUN pnpm install --frozen-lockfile

# Copy source trees
COPY packages/ ./packages/
COPY apps/web/ ./apps/web/

# Ensure public directory exists for deterministic copying
RUN mkdir -p /app/apps/web/public

# Build Next.js application in standalone mode
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @cco/shared --filter @cco/domain --filter @cco/contracts build
RUN pnpm --filter web build

# Purge dev dependencies, compiler tools, test files, and source trees from standalone output
RUN rm -rf /app/apps/web/.next/standalone/node_modules/.pnpm/typescript* /app/apps/web/.next/standalone/node_modules/typescript 2>/dev/null || true
RUN rm -rf /app/apps/web/.next/standalone/node_modules/.pnpm/vitest* /app/apps/web/.next/standalone/node_modules/vitest 2>/dev/null || true
RUN find /app/apps/web/.next/standalone -type d -name "src" -exec rm -rf {} + 2>/dev/null || true
RUN find /app/apps/web/.next/standalone -type f -name "*.ts" ! -name "*.d.ts" -delete 2>/dev/null || true
RUN find /app/apps/web/.next/standalone -type f -name "*.tsbuildinfo" -delete 2>/dev/null || true
RUN find /app/apps/web/.next/standalone -type f -name "*.test.js*" -delete 2>/dev/null || true
RUN find /app/apps/web/.next/standalone -type f -name "*.test.d.ts*" -delete 2>/dev/null || true

# Stage 2: Runtime stage
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NEXT_TELEMETRY_DISABLED=1

# Fixed unprivileged non-root user
USER node

# Copy standalone output, static assets, and public directory with unprivileged ownership
COPY --chown=node:node --from=builder /app/apps/web/.next/standalone ./
COPY --chown=node:node --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --chown=node:node --from=builder /app/apps/web/public ./apps/web/public

# Documented container port
EXPOSE 3000

# Exec-form command
CMD ["node", "apps/web/server.js"]
