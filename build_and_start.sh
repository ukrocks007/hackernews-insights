#!/bin/bash
# build_and_start.sh - Installs dependencies, builds, and starts the server. Logs output to cron.log.

LOG_FILE="$(dirname "$0")/cron.log"

cd "$(dirname "$0")"

# Install dependencies
npm install >> "$LOG_FILE" 2>&1

# Build project
npm run build >> "$LOG_FILE" 2>&1

# DB migrations
npx prisma migrate deploy >> "$LOG_FILE" 2>&1

# Start server
npm start >> "$LOG_FILE" 2>&1
