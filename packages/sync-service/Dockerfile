FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/sync-service/package*.json ./packages/sync-service/

# Install dependencies
RUN npm install

# Copy source
COPY packages/shared/ ./packages/shared/
COPY packages/sync-service/ ./packages/sync-service/

# Build shared first, then sync-service
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/sync-service

# Production image
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/packages/shared/package*.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist/ ./packages/shared/dist/
COPY --from=builder /app/packages/sync-service/package*.json ./packages/sync-service/
COPY --from=builder /app/packages/sync-service/dist/ ./packages/sync-service/dist/

RUN npm install --omit=dev

EXPOSE 8080

CMD ["node", "packages/sync-service/dist/index.js"]
