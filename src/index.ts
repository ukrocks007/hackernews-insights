import {
  initDB,
  closeDB,
} from "./storage";
import { sendErrorNotification } from "./notifier";
import { startFeedbackServer } from "./feedbackServer";
import logger from "./logger";
export { fetchAndFilterStories } from './insightTracker';

async function main() {
  try {
    logger.info("Starting HN Insights Agent...");
    await initDB();
    try {
      const server = await startFeedbackServer();
      if (server) {
        logger.info("Feedback server started successfully. Application is running...");
        // Keep the process alive - the server will handle incoming requests
        // Process will only exit on fatal errors or manual termination
      } else {
        logger.info("Feedback server disabled. Application is running...");
      }
    } catch (error) {
      const reason =
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error);
      logger.warn(
        "Feedback server failed to start. Possible causes include the feedback port already being in use or missing configuration (e.g., environment variables). Continuing without feedback endpoint.",
        "\nReason:",
        reason,
        "\nRaw error:",
        error
      );
    }
    // Do not auto-run fetchAndFilterStories here; it is triggered via endpoint
  } catch (error: any) {
    logger.error("Fatal error in HN Insights Agent:", error);
    await sendErrorNotification(error);
    await closeDB();
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info("Received SIGINT signal. Shutting down gracefully...");
  await closeDB();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info("Received SIGTERM signal. Shutting down gracefully...");
  await closeDB();
  process.exit(0);
});

main();
