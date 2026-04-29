# ============================================================================
# Stage 1: Builder
# ============================================================================
FROM node:22-alpine AS builder

# Instalar deps de build para bcrypt y otros nativos
RUN apk add --no-cache python3 make g++ openssl

WORKDIR /app

# Copiar package files
COPY package*.json ./
COPY prisma ./prisma

# Instalar TODAS las deps (incluidas dev) para poder buildear
# postinstall corre prisma generate automáticamente
RUN npm ci

# Copiar el resto del código
COPY . .

# Build (corre prisma generate && nest build)
# DATABASE_URL dummy solo para que prisma generate no falle.
# La real se inyecta en runtime desde docker-compose.
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy?schema=public"
RUN npm run build

# Quitar dev dependencies para reducir tamaño
RUN npm prune --production

# ============================================================================
# Stage 2: Runtime
# ============================================================================
FROM node:22-alpine AS runtime

# Solo openssl para Prisma en runtime
RUN apk add --no-cache openssl

WORKDIR /app

# Copiar solo lo necesario del builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package*.json ./

# Crear usuario no-root para correr la app
RUN addgroup -S nestjs && adduser -S nestjs -G nestjs
RUN chown -R nestjs:nestjs /app
USER nestjs

# Exponer puerto
EXPOSE 3001

# Healthcheck básico
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001', (r) => { process.exit(r.statusCode < 500 ? 0 : 1); }).on('error', () => process.exit(1));"

# Comando de inicio: aplicar migraciones de Prisma y arrancar
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main"]