# ─────────────────────────────────────────────────────────────────────────────
# CampusFlow Backend — Multi-stage Dockerfile
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Install dependencies ────────────────────────────────────────────
FROM node:20-bookworm-slim AS deps

WORKDIR /app

# Install build tools required by Prisma/native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./

# Production deps
RUN npm ci --omit=dev --ignore-scripts && \
    cp -R node_modules /app/node_modules_prod

# Full deps for build stage
RUN npm ci --ignore-scripts

# ── Stage 2: Build ───────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Compile NestJS
RUN npm run build

# ── Stage 3: Production Runner ───────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install runtime packages Prisma may need
RUN apt-get update && apt-get install -y \
    openssl \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Copy production dependencies
COPY --from=deps /app/node_modules_prod ./node_modules

# Copy Prisma engines generated during build
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package.json ./

EXPOSE 3001

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

# Run migrations and start app
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]