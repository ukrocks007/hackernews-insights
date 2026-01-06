import { scrapeStoryContent } from './contentScraper';
import { INITIAL_RELEVANCE_SCORE, toDisplayScore } from './feedback';
import { browseWithLLMFallback } from './fallbackBrowser';
import logger from './logger';
import { sendNotification, sendStoryNotification } from './notifier';
import { MIN_HN_SCORE, checkRelevance } from './relevanceAgent';
import { ScrapedStory } from './hnScraper';
import { getSourceRegistry, HACKERNEWS_SOURCE_ID, NormalizedStoryCandidate, StructuredIngestOptions } from './sourceRegistry';
import { hasStoryBeenProcessed, StoryInput, saveStory, getUnsentRelevantStories, markStoryAsSent } from './storage';

const MAX_HN_PAGES = 6; // 1 initial + 5 retries

function isBelowScoreThreshold(candidate: NormalizedStoryCandidate): boolean {
  if (candidate.sourceId !== HACKERNEWS_SOURCE_ID) return false;
  const score = candidate.score;
  if (score === undefined || score === null) return false;
  return score < MIN_HN_SCORE;
}

function toScrapedStory(candidate: NormalizedStoryCandidate): ScrapedStory {
  return {
    id: candidate.id,
    title: candidate.title,
    url: candidate.url,
    score: candidate.score ?? 0,
    rank: candidate.rank ?? 0,
  };
}

async function processCandidate(candidate: NormalizedStoryCandidate): Promise<boolean> {
  const duplicate = await hasStoryBeenProcessed(candidate.id);
  if (duplicate) {
    logger.info(`Story ${candidate.id} ("${candidate.title}") already processed. Skipping.`);
    return false;
  }

  if (isBelowScoreThreshold(candidate)) {
    logger.info(`Pre-filter: Rejected "${candidate.title}" (Score ${candidate.score} < ${MIN_HN_SCORE})`);
    return false;
  }

  const content = candidate.content ?? (await scrapeStoryContent(candidate.url));

  if (!content) {
    logger.warn(`Skipping "${candidate.title}" (Content fetch failed or skipped)`);
    return false;
  }

  const relevanceInput = toScrapedStory(candidate);
  const result = await checkRelevance(relevanceInput, content);

  if (result) {
    logger.info(`MATCH: ${candidate.title} - ${result.reason}`);

    const fullStory: StoryInput = {
      ...relevanceInput,
      date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
      reason: result.reason,
      relevanceScore: INITIAL_RELEVANCE_SCORE,
      notificationSent: false,
    };

    await saveStory(fullStory);
    return true;
  }

  logger.info(`IGNORE: ${candidate.title}`);
  return false;
}

async function processCandidates(candidates: NormalizedStoryCandidate[]): Promise<number> {
  let relevantStoriesFound = 0;
  for (const candidate of candidates) {
    const stored = await processCandidate(candidate);
    if (stored) {
      relevantStoriesFound++;
    }
  }
  return relevantStoriesFound;
}

async function runHackerNewsStructured(ingestor: (options?: StructuredIngestOptions) => Promise<NormalizedStoryCandidate[]>): Promise<number> {
  let relevantStoriesFound = 0;
  let page = 1;

  while (relevantStoriesFound === 0 && page <= MAX_HN_PAGES) {
    logger.info(`--- Processing Hacker News Page ${page} (structured) ---`);
    const scrapedStories = await ingestor({ page, limit: 30 });
    logger.info(`Scraped ${scrapedStories.length} stories from page ${page}.`);

    if (scrapedStories.length === 0) {
      logger.info('No stories found on this page. Stopping.');
      break;
    }

    relevantStoriesFound += await processCandidates(scrapedStories);

    if (relevantStoriesFound === 0) {
      page++;
      if (page <= MAX_HN_PAGES) {
        logger.info('No relevant stories found yet. Moving to next page...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  return relevantStoriesFound;
}

async function deliverNotifications() {
  const unsentStories = await getUnsentRelevantStories();
  logger.info(`Total unsent relevant stories in pool: ${unsentStories.length}`);

  if (unsentStories.length === 0) {
    logger.info('No relevant stories to send.');
    await sendNotification('No strong HN signals today.', 'HN Insights - Empty');
    return;
  }

  const topStories = unsentStories.slice(0, 5);
  logger.info(`Sending notifications for top ${topStories.length} stories...`);

  for (const story of topStories) {
    logger.info(
      `Selected "${story.title}" (Relevance ${toDisplayScore(story.relevanceScore)}; Score ${story.score}); reason=${story.reason ?? 'N/A'}`
    );
    await sendStoryNotification(story);
    await markStoryAsSent(story.id);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

async function fetchAndFilterStories() {
  const registry = getSourceRegistry();
  let totalRelevant = 0;

  for (const source of registry) {
    if (source.supportsStructuredIngest && source.structuredIngestor) {
      logger.info(`[ingestion] ${source.sourceId}: using structured ingestor (code-first).`);
      if (source.sourceId === HACKERNEWS_SOURCE_ID) {
        totalRelevant += await runHackerNewsStructured(source.structuredIngestor);
      } else {
        const candidates = await source.structuredIngestor();
        totalRelevant += await processCandidates(candidates);
      }
    } else if (source.fallbackBrowsingAllowed) {
      logger.info(`[ingestion] ${source.sourceId}: using fallback LLM-guided browsing.`);
      const seeds = source.seedUrls ?? [];
      if (seeds.length === 0) {
        logger.warn(`[ingestion] ${source.sourceId}: fallback browsing enabled but no seed URLs provided. Skipping.`);
        continue;
      }

      for (const seed of seeds) {
        const candidates = await browseWithLLMFallback({
          sourceId: source.sourceId,
          seedUrl: seed,
          domainAllowlist: source.domainAllowlist,
        });
        if (candidates.length === 0) {
          logger.info(`[ingestion] ${source.sourceId}: no candidates surfaced from fallback browsing for ${seed}.`);
        }
        totalRelevant += await processCandidates(candidates);
      }
    } else {
      logger.info(`[ingestion] ${source.sourceId}: no ingestion path available, skipping.`);
    }
  }

  await deliverNotifications();
  return totalRelevant;
}

export { fetchAndFilterStories };
