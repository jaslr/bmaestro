FROM alpine:latest

ARG PB_VERSION=0.25.0

# Install dependencies
RUN apk add --no-cache \
    unzip \
    ca-certificates \
    wget

# Download and install PocketBase
RUN wget https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip \
    && unzip pocketbase_${PB_VERSION}_linux_amd64.zip -d /pb/ \
    && rm pocketbase_${PB_VERSION}_linux_amd64.zip

# Create directories
RUN mkdir -p /pb/pb_data /pb/pb_migrations

# Copy migrations
COPY pb_migrations/ /pb/pb_migrations/

# Create startup script
COPY start.sh /pb/start.sh
RUN chmod +x /pb/start.sh

EXPOSE 8080

CMD ["/pb/start.sh"]
