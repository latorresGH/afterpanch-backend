# Usar Node 20 explícitamente
FROM node:20-alpine

WORKDIR /app

# Copiar package.json y package-lock.json
COPY package*.json ./
COPY prisma ./prisma/

# Instalar dependencias
RUN npm ci

# Generar Prisma Client
RUN npx prisma generate

# Copiar el resto del código
COPY . .

# Build de NestJS
RUN npm run build

# Exponer puerto
EXPOSE 3000

# Comando de inicio: migrar y levantar
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
