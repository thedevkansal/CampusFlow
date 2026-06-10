# ─────────────────────────────────────────────────────────────────────────────
# CampusFlow Backend — Multi-stage Dockerfile
# Stage 1: deps     — install all dependencies
# Stage 2: builder  — compile TypeScript
# Stage 3: runner   — minimal production image
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Install dependencies ────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Install build tools for native modules
RUN apk add --no-cache libc6-compat python3 make g++

COPY package.json package-lock.json* ./

RUN npm ci --only=production --ignore-scripts && \
    cp -R node_modules /app/node_modules_prod && \
    npm ci --ignore-scripts

# ── Stage 2: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Compile TypeScript
RUN npm run build

# ── Stage 3: Production runner ───────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs && \
    mkdir -p /app/logs && \
    chown -R nestjs:nodejs /app/logs

# Copy only what's needed for production
COPY --from=deps /app/node_modules_prod ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma
COPY package.json ./

USER nestjs

EXPOSE 3001

# Healthcheck — matches GET /health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

# Run database migrations then start the server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
