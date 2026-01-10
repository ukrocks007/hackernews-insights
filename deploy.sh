#!/bin/bash
# deploy.sh - Install, build, migrate, then restart PM2 app

LOG_FILE="$(dirname "$0")/deploy.log"
cd "$(dirname "$0")"

echo "==== Deploy started at $(date) ====" >> "$LOG_FILE"

# Install dependencies
npm install >> "$LOG_FILE" 2>&1

# Build project
npm run build >> "$LOG_FILE" 2>&1

# DB migrations
npx prisma migrate deploy >> "$LOG_FILE" 2>&1

# Start or restart app via PM2
pm2 start ecosystem.config.js --update-env >> "$LOG_FILE" 2>&1

# Persist PM2 process list
pm2 save >> "$LOG_FILE" 2>&1

echo "==== Deploy finished at $(date) ====" >> "$LOG_FILE"

