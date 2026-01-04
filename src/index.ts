import { initDB, closeDB, saveStory, hasStoryBeenProcessed, getUnsentRelevantStories, markStoryAsSent, Story } from './storage';
import { scrapeTopStories } from './hnScraper';
import { checkRelevance } from './relevanceAgent';
import { sendStoryNotification, sendErrorNotification, sendNotification } from './notifier';

async function main() {
  try {
    console.log('Starting HN Insights Agent...');
    
    // 1. Initialize Database
    await initDB();

    // 2. Scrape Top Stories
    const scrapedStories = await scrapeTopStories(30);
    console.log(`Scraped ${scrapedStories.length} stories.`);

    // 3. Process Stories (Filter & Save)
    for (const story of scrapedStories) {
      // Check if already processed to avoid duplicates and save LLM costs
      const isProcessed = await hasStoryBeenProcessed(story.id);
      if (isProcessed) {
        console.log(`Story ${story.id} ("${story.title}") already processed. Skipping.`);
        continue;
      }

      console.log(`Checking relevance for: "${story.title}"...`);
      const result = await checkRelevance(story);

      if (result) {
        console.log(`MATCH: ${story.title} - ${result.reason} (Score: ${result.score})`);
        
        const fullStory: Story = {
          ...story,
          date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
          reason: result.reason,
          relevance_score: result.score,
          notification_sent: false
        };

        await saveStory(fullStory);
      } else {
        console.log(`IGNORE: ${story.title}`);
      }
    }

    // 4. Select Top 5 Unsent Stories (from today and past)
    const unsentStories = await getUnsentRelevantStories();
    console.log(`Total unsent relevant stories in pool: ${unsentStories.length}`);

    if (unsentStories.length === 0) {
      console.log('No relevant stories to send.');
      await sendNotification('No strong HN signals today.', 'HN Insights - Empty');
    } else {
      // Sort by relevance score (desc), then HN score (desc)
      // Note: SQL query already does this, but good to be explicit if logic changes
      const topStories = unsentStories.slice(0, 5);
      
      console.log(`Sending notifications for top ${topStories.length} stories...`);
      
      for (const story of topStories) {
        await sendStoryNotification(story);
        await markStoryAsSent(story.id);
        // Small delay to ensure order
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

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
