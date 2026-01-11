# PM2 Usage Guide - HN Insights

## Critical Fixes Applied ✅

The following issues were identified and fixed to ensure PM2 logs work properly:

1. **Application Exit Bug** 🐛 → **FIXED**: The `main()` function had a `finally` block that closed the database and exited immediately after starting the server. Removed the `finally` block - the app now stays alive.

2. **Logger Buffering** 🐛 → **FIXED**: Updated logger to use direct stream writes (`process.stdout.write`) instead of `console.log` to prevent buffering in PM2.

3. **Signal Handling** ✅ **ADDED**: Proper SIGINT/SIGTERM handlers for graceful shutdown when stopping PM2.

4. **Error Formatting** ✅ **IMPROVED**: Better error and object logging with stack traces and formatted JSON.

5. **Auto-Deploy on Start** ✅ **ADDED**: PM2 now automatically runs `deploy.sh` before starting the application.

## How It Works

When you run `pm2 start ecosystem.config.js`, the following happens automatically:

1. **Deploy Phase** (`deploy.sh` runs):
   - Installs dependencies (`npm install`)
   - Builds the project (`npm run build`)
   - Runs database migrations (`npx prisma migrate deploy`)
2. **Start Phase**:
   - Application starts with the built code
   - Logs appear in PM2 immediately

This ensures your application is always deployed properly before starting.

## Quick Start

```bash
# Start with PM2 (deploy.sh runs automatically)
pm2 start ecosystem.config.js

# View logs in real-time
pm2 logs hn-insights-server

# Open monitoring dashboard
pm2 monit
```

## Common Commands

```bash
# Status
pm2 status
pm2 list

# Logs
pm2 logs hn-insights-server          # Live logs
pm2 logs hn-insights-server --lines 100  # Last 100 lines
pm2 logs hn-insights-server --err    # Only errors

# Control
pm2 restart hn-insights-server
pm2 stop hn-insights-server
pm2 delete hn-insights-server

# Monitoring
pm2 monit                           # Live dashboard
pm2 show hn-insights-server         # Detailed info

# Log management
pm2 flush hn-insights-server        # Clear logs
```

## Log Files

Logs are stored in the `logs/` directory:

- `logs/output.log` - Standard output (INFO logs)
- `logs/error.log` - Error output (WARN, ERROR logs)
- `logs/combined.log` - All logs combined

View logs directly:

```bash
tail -f logs/output.log
tail -f logs/error.log
```

## Troubleshooting

### Logs not showing?

1. **Verify the app is running:**

   ```bash
   pm2 status
   ```

2. **Check if app keeps restarting:**

   ```bash
   pm2 logs hn-insights-server --err --lines 50
   ```

3. **Flush and restart:**

   ```bash
   pm2 flush hn-insights-server
   pm2 restart hn-insights-server
   pm2 logs hn-insights-server
   ```

4. **Check log files directly:**

   ```bash
   ls -lh logs/
   tail -f logs/output.log
   ```

5. **Test logger manually:**
   ```bash
   node -e "require('./dist/logger.js').default.info('Test message');"
   ```

### App exits immediately?

This was the main bug - now fixed. The app should stay running. Check:

```bash
pm2 logs hn-insights-server
```

You should see:

```
[INFO] [timestamp] Starting HN Insights Agent...
[INFO] [timestamp] Feedback server started successfully. Application is running...
```

If you see "Done." immediately, the old code is still running. Rebuild:

```bash
npm run build
pm2 restart hn-insights-server
```

## Auto-start on Boot

```bash
# Save current PM2 process list
pm2 save

# Generate and run startup script
pm2 startup
# Follow the instructions shown

# Now PM2 will auto-start on boot
```

## Updating the Application

When you need to deploy changes:

```bash
# Option 1: Restart (deploy.sh runs automatically)
pm2 restart hn-insights-server

# Option 2: Stop and start (also runs deploy.sh)
pm2 stop hn-insights-server
pm2 start ecosystem.config.js

# Option 3: Manual deploy then reload
bash deploy.sh
pm2 reload hn-insights-server
```

**Note:** When using `pm2 restart`, the wrapper script will run `deploy.sh` automatically, so your code will be rebuilt and migrations will run before the app starts.

## Environment Variables

The app uses `.env` file which is copied to `dist/.env` during build (which happens automatically via deploy.sh).

To update environment variables:

1. Edit `.env`
2. Run `pm2 restart hn-insights-server` (deploy.sh will rebuild automatically)

## Deployment Workflow

The ecosystem config uses a wrapper script that ensures `deploy.sh` runs before every start:

```
pm2 start/restart
    ↓
start-with-deploy.sh runs
    ↓
deploy.sh executes:
  - npm install (dependencies)
  - npm run build (compile TypeScript)
  - prisma migrate deploy (database)
    ↓
Application starts
    ↓
Logs appear in PM2
```

### Manual Deploy

If you want to run deploy steps manually without PM2:

```bash
# Run deploy script
bash deploy.sh

# Then start with PM2 (won't re-run deploy)
pm2 start dist/index.js --name hn-insights-manual
```

### Skip Deploy (Advanced)

If you want to start without running deploy.sh:

```bash
# Start directly with Node.js
pm2 start dist/index.js --name hn-insights-server

# Or temporarily modify ecosystem.config.js to use dist/index.js instead of start-with-deploy.sh
```

## What Was Fixed

### Before (Broken):

```typescript
async function main() {
  try {
    await initDB();
    await startFeedbackServer();
  } catch (error) {
    logger.error("Fatal error", error);
    process.exit(1);
  } finally {
    await closeDB(); // ❌ This runs immediately!
    logger.info("Done."); // ❌ App exits!
  }
}
```

### After (Fixed):

```typescript
async function main() {
  try {
    await initDB();
    const server = await startFeedbackServer();
    if (server) {
      logger.info("Application is running..."); // ✅ App stays alive
    }
  } catch (error) {
    logger.error("Fatal error", error);
    await closeDB();
    process.exit(1);
  }
  // ✅ No finally block - server keeps running
}

// ✅ Graceful shutdown on signals
process.on("SIGINT", async () => {
  logger.info("Shutting down gracefully...");
  await closeDB();
  process.exit(0);
});
```

## Verification

After starting with PM2, verify logs are working:

```bash
# Start the app
pm2 start ecosystem.config.js

# You should see startup logs immediately:
pm2 logs hn-insights-server --lines 20

# Expected output:
# [INFO] [timestamp] Starting HN Insights Agent...
# [INFO] [timestamp] Feedback server listening on http://0.0.0.0:3000
# [INFO] [timestamp] Feedback server started successfully. Application is running...

# Test the dashboard to generate more logs:
curl http://localhost:3000/

# Check pm2 monit - logs should appear in real-time
pm2 monit
```

## Success Indicators

✅ App status shows "online" (not "stopped" or "errored")
✅ Logs appear immediately in `pm2 logs`
✅ Logs appear in `pm2 monit` dashboard
✅ Log files in `logs/` directory are being written to
✅ App uptime increases (doesn't restart immediately)

## Need Help?

If logs still don't appear:

1. Check `pm2 status` - app should be "online"
2. Check `pm2 logs hn-insights-server --err` for errors
3. Check `logs/error.log` directly
4. Check `deploy.log` for build/migration errors
5. Verify build: `npm run build` completed successfully
6. Try: `pm2 delete hn-insights-server && pm2 start ecosystem.config.js`

## Summary

**Key Points:**

- ✅ `deploy.sh` runs automatically on every `pm2 start` or `pm2 restart`
- ✅ No need to manually run `npm install`, `npm run build`, or migrations
- ✅ Logs appear immediately in PM2
- ✅ Application stays running (doesn't exit)
- ✅ Graceful shutdown on stop/restart

**Usage:**

```bash
pm2 start ecosystem.config.js    # Deploy + Start
pm2 restart hn-insights-server    # Deploy + Restart
pm2 logs hn-insights-server       # View logs
pm2 monit                         # Live monitoring
```

That's it! Your application will auto-deploy before starting every time. 🚀
