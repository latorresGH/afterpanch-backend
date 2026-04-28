# Usar Node 20 explícitamente
FROM node:20-alpine

WORKDIR /app

# DATABASE_URL dummy solo para que prisma generate no falle en build.
# La real la inyecta Railway en runtime.
ENV DATABASE_URL="postgresql://user:pass@localhost:5432/db"

# Copiar package.json y package-lock.json
COPY package*.json ./
COPY prisma ./prisma/

# Instalar dependencias (postinstall ya corre prisma generate)
RUN npm ci

# Copiar el resto del código
COPY . .

# Build de NestJS (ya no incluye prisma generate, ver scripts)
RUN npm run build

# Exponer puerto
EXPOSE 3000

# Comando de inicio: migrar y levantar
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]