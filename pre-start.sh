#!/bin/bash
# pre-start.sh - Runs before PM2 starts the application

cd "$(dirname "$0")"

echo "[$(date)] Running pre-start deployment tasks..."

# Install dependencies
echo "[$(date)] Installing dependencies..."
npm install

# Build project
echo "[$(date)] Building project..."
npm run build

# Run DB migrations
echo "[$(date)] Running database migrations..."
npx prisma migrate deploy

echo "[$(date)] Pre-start tasks completed successfully!"
