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

# Copy source trees for required packages and apps
COPY packages/ ./packages/
COPY apps/control-api/ ./apps/control-api/

# Build Control API and its workspace dependency closure
RUN pnpm --filter control-api... build

# Deploy isolated production runtime closure
RUN pnpm --filter control-api --prod deploy /app/pruned

# Purge any remaining development source trees, test files, and build info from runtime closure
RUN find /app/pruned -type d -name "src" -exec rm -rf {} + 2>/dev/null || true
RUN find /app/pruned -type f -name "*.ts" ! -name "*.d.ts" -delete 2>/dev/null || true
RUN find /app/pruned -type f -name "*.tsbuildinfo" -delete 2>/dev/null || true
RUN find /app/pruned -type f -name "*.test.js*" -delete 2>/dev/null || true
RUN find /app/pruned -type f -name "*.test.d.ts*" -delete 2>/dev/null || true

# Stage 2: Runtime stage
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Fixed unprivileged non-root user
USER node

# Copy compiled production closure with unprivileged ownership
COPY --chown=node:node --from=builder /app/pruned /app

# Documented container port
EXPOSE 3000

# Exec-form command
CMD ["node", "dist/bootstrap.js"]
