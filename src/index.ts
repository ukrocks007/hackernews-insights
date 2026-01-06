import { initDB, closeDB } from './storage';
import { sendErrorNotification } from './notifier';
import { startFeedbackServer } from './feedbackServer';

async function main() {
  try {
    console.log('Starting HN Insights Agent...');
    
    // 1. Initialize Database
    await initDB();
    try {
      await startFeedbackServer();
    } catch (error) {
      const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.warn(
        'Feedback server failed to start. Possible causes include the feedback port already being in use or missing configuration (e.g., environment variables). Continuing without feedback endpoint.',
        '\nReason:',
        reason,
        '\nRaw error:',
        error
      );
    }

    // await fetchAndFilterStories();

  } catch (error: any) {
    console.error('Fatal error in HN Insights Agent:', error);
    await sendErrorNotification(error);
    process.exit(1);
  } finally {
    await closeDB();
    console.log('Done.');
  }
}

main();
