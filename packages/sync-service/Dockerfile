FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files and tsconfig
COPY package*.json ./
COPY tsconfig.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/sync-service/package*.json ./packages/sync-service/
COPY packages/extension/package*.json ./packages/extension/

# Install dependencies
RUN npm install

# Copy source
COPY packages/shared/ ./packages/shared/
COPY packages/sync-service/ ./packages/sync-service/
COPY packages/extension/ ./packages/extension/

# Build shared first, then sync-service and extension
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/sync-service
RUN npm run build --workspace=packages/extension

# Create extension zip
RUN apk add --no-cache zip
RUN mkdir -p /app/extension-dist && \
    cd /app/packages/extension/dist && \
    zip -r /app/extension-dist/bmaestro-extension.zip .

# Production image
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/packages/shared/package*.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist/ ./packages/shared/dist/
COPY --from=builder /app/packages/sync-service/package*.json ./packages/sync-service/
COPY --from=builder /app/packages/sync-service/dist/ ./packages/sync-service/dist/

# Copy extension zip
COPY --from=builder /app/extension-dist/ ./extension/

RUN npm install --omit=dev

ENV EXTENSION_DIR=/app/extension

EXPOSE 8080

CMD ["node", "packages/sync-service/dist/index.js"]
