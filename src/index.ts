import { initDB, closeDB, saveStory, hasStoryBeenProcessed, getUnsentRelevantStories, markStoryAsSent, Story } from './storage';
import { scrapeTopStories } from './hnScraper';
import { checkRelevance, MIN_HN_SCORE, MAX_RANK } from './relevanceAgent';
import { sendStoryNotification, sendErrorNotification, sendNotification } from './notifier';
import { scrapeStoryContent } from './contentScraper';
import logger from './logger';

async function main() {
  try {
    logger.info('Starting HN Insights Agent...');
    
    // 1. Initialize Database
    await initDB();

    let relevantStoriesFound = 0;
    let page = 1;
    const MAX_PAGES = 6; // 1 initial + 5 retries

    while (relevantStoriesFound === 0 && page <= MAX_PAGES) {
      logger.info(`--- Processing Page ${page} ---`);

      // 2. Scrape Top Stories
      const scrapedStories = await scrapeTopStories(30, page);
      logger.info(`Scraped ${scrapedStories.length} stories from page ${page}.`);

      if (scrapedStories.length === 0) {
        logger.info('No stories found on this page. Stopping.');
        break;
      }

      // 3. Process Stories (Filter & Save)
      for (const story of scrapedStories) {
        // Check if already processed to avoid duplicates and save LLM costs
        const isProcessed = await hasStoryBeenProcessed(story.id);
        if (isProcessed) {
          logger.info(`Story ${story.id} ("${story.title}") already processed. Skipping.`);
          continue;
        }

        // Deterministic Pre-filtering
        // if (story.rank > MAX_RANK) {
        //   console.log(`Pre-filter: Rejected "${story.title}" (Rank ${story.rank} > ${MAX_RANK})`);
        //   continue;
        // }

        if (story.score < MIN_HN_SCORE) {
          logger.info(`Pre-filter: Rejected "${story.title}" (Score ${story.score} < ${MIN_HN_SCORE})`);
          continue;
        }

        // Scrape Content
        logger.info(`Fetching content for: "${story.title}"...`);
        const content = await scrapeStoryContent(story.url);
        
        if (!content) {
          logger.info(`Skipping "${story.title}" (Content fetch failed or skipped)`);
          continue;
        }

        logger.info(`Checking relevance for: "${story.title}"...`);
        const result = await checkRelevance(story, content);

        if (result) {
          console.log(`MATCH: ${story.title} - ${result.reason}`);
          
          const fullStory: Story = {
            ...story,
            date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
            reason: result.reason,
            relevance_score: 1, // Binary relevance (1 = relevant)
            notification_sent: false
          };

          await saveStory(fullStory);
          relevantStoriesFound++;
        } else {
          console.log(`IGNORE: ${story.title}`);
        }
      }

      if (relevantStoriesFound > 0) {
        console.log(`Found ${relevantStoriesFound} relevant stories. Stopping pagination.`);
        break;
      }

      page++;
      if (page <= MAX_PAGES) {
        console.log('No relevant stories found yet. Moving to next page...');
        await new Promise(resolve => setTimeout(resolve, 2000));
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
