#!/bin/bash
# deploy.sh - Install, build, and migrate (PM2 will start the app)

LOG_FILE="$(dirname "$0")/deploy.log"
cd "$(dirname "$0")"

echo "==== Deploy started at $(date) ====" | tee -a "$LOG_FILE"

# Install dependencies
echo "Installing dependencies..." | tee -a "$LOG_FILE"
npm install >> "$LOG_FILE" 2>&1

# Build project
echo "Building project..." | tee -a "$LOG_FILE"
npm run build >> "$LOG_FILE" 2>&1

# DB migrations
echo "Running database migrations..." | tee -a "$LOG_FILE"
npx prisma migrate deploy >> "$LOG_FILE" 2>&1

echo "==== Deploy finished at $(date) ====" | tee -a "$LOG_FILE"

