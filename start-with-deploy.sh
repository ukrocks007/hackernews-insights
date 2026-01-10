#!/bin/bash
# start-with-deploy.sh - Wrapper that runs deploy.sh then starts the app

cd "$(dirname "$0")"

echo "[$(date)] Running deploy.sh..."
bash deploy.sh

if [ $? -eq 0 ]; then
    echo "[$(date)] Deploy completed successfully. Starting application..."
    exec node ./dist/index.js
else
    echo "[$(date)] Deploy failed! Check deploy.log for details."
    exit 1
fi
