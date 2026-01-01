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

# Create extension zip and CRX
RUN apk add --no-cache zip openssl
RUN npm install -g crx3

# Generate signing key if not provided (for CRX)
RUN mkdir -p /app/extension-dist

# Create ZIP
RUN cd /app/packages/extension/dist && \
    zip -r /app/extension-dist/bmaestro-extension.zip .

# Generate key and create CRX
RUN openssl genrsa -out /app/extension-dist/extension.pem 2048 2>/dev/null
RUN crx3 pack /app/packages/extension/dist \
    -o /app/extension-dist/bmaestro-extension.crx \
    -p /app/extension-dist/extension.pem

# Extract extension ID from key and save to file
RUN node -e "const crypto = require('crypto'); \
    const fs = require('fs'); \
    const pem = fs.readFileSync('/app/extension-dist/extension.pem', 'utf8'); \
    const der = crypto.createPublicKey(pem).export({type: 'spki', format: 'der'}); \
    const hash = crypto.createHash('sha256').update(der).digest('hex').slice(0, 32); \
    const id = hash.split('').map(c => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16))).join(''); \
    fs.writeFileSync('/app/extension-dist/extension-id.txt', id); \
    console.log('Extension ID:', id);"

# Copy manifest for version reading
RUN cp /app/packages/extension/dist/manifest.json /app/extension-dist/

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
