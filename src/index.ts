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
      await startFeedbackServer();
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
    process.exit(1);
  } finally {
    await closeDB();
    logger.info("Done.");
  }
}

main();
