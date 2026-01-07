import { createHash } from 'crypto';
import { scrapeTopStories, ScrapedStory } from './hnScraper';
import logger from './logger';
import { ContentSignals } from './contentScraper';

export const HACKERNEWS_SOURCE_ID = 'hackernews';

export interface NormalizedStoryCandidate {
  id: number;
  title: string;
  url: string;
  sourceId: string;
  score?: number | null;
  rank?: number | null;
  content?: ContentSignals | null;
}

export interface StructuredIngestOptions {
  page?: number;
  limit?: number;
}

export type StructuredIngestor = (options?: StructuredIngestOptions) => Promise<NormalizedStoryCandidate[]>;

export interface SourceCapability {
  sourceId: string;
  supportsStructuredIngest: boolean;
  structuredIngestor?: StructuredIngestor;
  fallbackBrowsingAllowed: boolean;
  domainAllowlist: string[];
  seedUrls?: string[];
}

function normalizeHackerNewsStory(story: ScrapedStory): NormalizedStoryCandidate {
  return {
    id: story.id,
    title: story.title,
    url: story.url,
    score: story.score,
    rank: story.rank,
    sourceId: HACKERNEWS_SOURCE_ID,
  };
}

export async function ingestHackerNewsStructured(options?: StructuredIngestOptions): Promise<NormalizedStoryCandidate[]> {
  const page = options?.page ?? 1;
  const limit = options?.limit ?? 30;
  const stories = await scrapeTopStories(limit, page);
  logger.info(`Structured ingest [hackernews]: fetched ${stories.length} candidates from page ${page}`);
  return stories.map(normalizeHackerNewsStory);
}

// Uses the first 44 bits of a SHA-256 digest to stay within JS safe integer range while keeping IDs deterministic.
export function deriveStoryIdFromUrl(url: string): number {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 11);
  return parseInt(hash, 16);
}

function parseCsvEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

export function getSourceRegistry(): SourceCapability[] {
  const fallbackSeeds = parseCsvEnv(process.env.FALLBACK_SEED_URLS);
  const fallbackAllowlist = parseCsvEnv(process.env.FALLBACK_DOMAIN_ALLOWLIST);
  const hackernoonSeeds = parseCsvEnv(process.env.HACKERNOON_SEED_URLS);
  const hackernoonAllowlist = parseCsvEnv(process.env.HACKERNOON_DOMAIN_ALLOWLIST);

  const hackerNews: SourceCapability = {
    sourceId: HACKERNEWS_SOURCE_ID,
    supportsStructuredIngest: true,
    structuredIngestor: ingestHackerNewsStructured,
    fallbackBrowsingAllowed: false,
    domainAllowlist: ['news.ycombinator.com'],
  };

  const fallbackBrowsing: SourceCapability = {
    sourceId: 'fallback-browse',
    supportsStructuredIngest: false,
    fallbackBrowsingAllowed: true,
    domainAllowlist: fallbackAllowlist,
    seedUrls: fallbackSeeds,
  };

  const hackernoon: SourceCapability = {
    sourceId: 'hackernoon',
    supportsStructuredIngest: false,
    fallbackBrowsingAllowed: true,
    domainAllowlist: hackernoonAllowlist.length ? hackernoonAllowlist : ['hackernoon.com'],
    seedUrls: hackernoonSeeds.length ? hackernoonSeeds : ['https://hackernoon.com/'],
  };

  return [hackerNews, hackernoon, fallbackBrowsing];
}
