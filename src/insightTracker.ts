import { scrapeStoryContent, ContentSignals } from "./contentScraper";
import { INITIAL_RELEVANCE_SCORE, toDisplayScore } from "./feedback";
import { scrapeTopStories } from "./hnScraper";
import { sendNotification, sendStoryNotification } from "./notifier";
import { MIN_HN_SCORE, checkRelevance } from "./relevanceAgent";
import { hasStoryBeenProcessed, StoryInput, saveStory, getUnsentRelevantStories, markStoryAsSent, TopicInput } from "./storage";
import { extractTopics } from "./topicExtractor";
import logger from "./logger";

const CONTENT_BASED_WEIGHT_RATIO = 0.3;
const METADATA_WEIGHT_RATIO = 0.15;

function buildFallbackContent(storyTitle: string): ContentSignals {
  return {
    pageTitle: storyTitle,
    description: '',
    headings: [],
    paragraphs: [],
    hasCodeBlocks: false,
    bodyText: '',
  };
}

async function fetchAndFilterStories() {
  let relevantStoriesFound = 0;
  let page = 1;
  const MAX_PAGES = 6; // 1 initial + 5 retries

  while (relevantStoriesFound === 0 && page <= MAX_PAGES) {
    console.log(`--- Processing Page ${page} ---`);

    // 2. Scrape Top Stories
    const scrapedStories = await scrapeTopStories(30, page);
    console.log(`Scraped ${scrapedStories.length} stories from page ${page}.`);

    if (scrapedStories.length === 0) {
      console.log('No stories found on this page. Stopping.');
      break;
    }

    // 3. Process Stories (Filter & Save)
    for (const story of scrapedStories) {
      // Check if already processed to avoid duplicates and save LLM costs
      const isProcessed = await hasStoryBeenProcessed(story.id);
      if (isProcessed) {
        console.log(`Story ${story.id} ("${story.title}") already processed. Skipping.`);
        continue;
      }

      // Deterministic Pre-filtering
      // if (story.rank > MAX_RANK) {
      //   console.log(`Pre-filter: Rejected "${story.title}" (Rank ${story.rank} > ${MAX_RANK})`);
      //   continue;
      // }
      if (story.score < MIN_HN_SCORE) {
        console.log(`Pre-filter: Rejected "${story.title}" (Score ${story.score} < ${MIN_HN_SCORE})`);
        continue;
      }

      // Scrape Content
      console.log(`Fetching content for: "${story.title}"...`);
      const scrapedContent = await scrapeStoryContent(story.url);
      const content: ContentSignals = scrapedContent ?? buildFallbackContent(story.title);

      if (!scrapedContent) {
        logger.warn(`Content fetch failed for "${story.title}". Using title/URL only.`);
      }

      const topics = extractTopics(story.title, story.url, scrapedContent);
      const topicInputs: TopicInput[] = topics.finalTopics.map(name => ({
        name,
        source: scrapedContent ? 'content' : 'metadata',
        weight: scrapedContent
          ? Math.round(INITIAL_RELEVANCE_SCORE * CONTENT_BASED_WEIGHT_RATIO)
          : Math.round(INITIAL_RELEVANCE_SCORE * METADATA_WEIGHT_RATIO),
      }));
      logger.info(
        `Topics for "${story.title}": ${topics.finalTopics.join(', ') || 'none'} (removed: ${topics.removed.join(', ') || 'none'}, added: ${topics.added.join(', ') || 'none'})`
      );

      console.log(`Checking relevance for: "${story.title}"...`);
      const result = await checkRelevance(story, content);

      if (result) {
        console.log(`MATCH: ${story.title} - ${result.reason}`);

        const fullStory: StoryInput = {
          ...story,
          date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
          reason: result.reason,
          relevanceScore: INITIAL_RELEVANCE_SCORE, // boost initial relevance for freshly matched stories (scaled)
          notificationSent: false,
        };

        await saveStory(fullStory, topicInputs);
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
      console.log(
        `Selected "${story.title}" (Relevance ${toDisplayScore(story.relevanceScore)}; Score ${story.score}); reason=${story.reason ?? 'N/A'}`
      );
      await sendStoryNotification(story);
      await markStoryAsSent(story.id);
      // Small delay to ensure order
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

export { fetchAndFilterStories };
