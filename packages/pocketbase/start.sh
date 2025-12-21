#!/bin/sh

echo "Starting BMaestro PocketBase..."

exec /pb/pocketbase serve \
    --http=0.0.0.0:8080 \
    --migrationsDir=/pb/pb_migrations \
    --origins=https://bmaestro-sync.fly.dev,https://bmaestro.fly.dev,http://localhost:3847,http://localhost:3848
