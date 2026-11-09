# Production Dockerfile for LastPlate (Node.js + SQLite)
FROM node:22-alpine AS builder

WORKDIR /app

# Install native build tools for better-sqlite3 compilation
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY . .

EXPOSE 3000

CMD ["npm", "start"]

