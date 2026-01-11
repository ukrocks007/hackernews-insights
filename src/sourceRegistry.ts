import { createHash } from "crypto";
import { scrapeTopStories, ScrapedStory } from "./hnScraper";
import { scrapeTaggedStories } from "./hackernoonScraper";
import { scrapeGithubBlogPosts, GithubBlogItem } from "./githubBlogScraper";
import { scrapeSubstackArchive, SubstackItem } from "./substackScraper";
import {
  scrapeAddyOsmaniBlog,
  AddyOsmaniBlogItem,
} from "./addyOsmaniBlogScraper";
import logger from "./logger";
import { ContentSignals } from "./contentScraper";

export const HACKERNEWS_SOURCE_ID = "hackernews";
export const GITHUB_BLOG_SOURCE_ID = "github_blog";
export const ADDY_OSMANI_BLOG_SOURCE_ID = "addy_osmani_blog";

export interface NormalizedStoryCandidate {
  id: string;
  title: string;
  url: string;
  sourceId: string;
  score?: number | null;
  rank?: number | null;
  date?: string | null;
  content?: ContentSignals | null;
}

export interface StructuredIngestOptions {
  page?: number;
  limit?: number;
}

export type StructuredIngestor = (
  options?: StructuredIngestOptions,
) => Promise<NormalizedStoryCandidate[]>;

export interface SourceCapability {
  sourceId: string;
  supportsStructuredIngest: boolean;
  structuredIngestor?: StructuredIngestor;
  fallbackBrowsingAllowed: boolean;
  domainAllowlist: string[];
  seedUrls?: string[];
}

function normalizeHackerNewsStory(
  story: ScrapedStory,
): NormalizedStoryCandidate {
  return {
    id: `hackernews:${story.id}`,
    title: story.title,
    url: story.url,
    score: story.score,
    rank: story.rank,
    sourceId: HACKERNEWS_SOURCE_ID,
  };
}

export async function ingestHackerNewsStructured(
  options?: StructuredIngestOptions,
): Promise<NormalizedStoryCandidate[]> {
  const page = options?.page ?? 1;
  const limit = options?.limit ?? 30;
  const stories = await scrapeTopStories(limit, page);
  logger.info(
    `Structured ingest [hackernews]: fetched ${stories.length} candidates from page ${page}`,
  );
  return stories.map(normalizeHackerNewsStory);
}

function normalizeHackernoonStoryFromItem(item: {
  title: string;
  url: string;
}): NormalizedStoryCandidate {
  return {
    id: deriveStoryIdFromUrl(item.url, "hackernoon"),
    title: item.title,
    url: item.url,
    sourceId: "hackernoon",
  };
}

export async function ingestHackernoonStructured(
  options?: StructuredIngestOptions,
): Promise<NormalizedStoryCandidate[]> {
  const page = options?.page ?? 1;
  const limit = options?.limit ?? 30;
  const tagUrl =
    process.env.HACKERNOON_TAG_URL ||
    "https://hackernoon.com/tagged/hackernoon-top-story";
  logger.info(
    `Structured ingest [hackernoon]: scraping ${tagUrl} page ${page}`,
  );
  const items = await scrapeTaggedStories(tagUrl, limit, page);
  return items.map(normalizeHackernoonStoryFromItem);
}

function normalizeGithubBlogItem(
  item: GithubBlogItem,
): NormalizedStoryCandidate {
  const description = item.excerpt ?? "";
  const fallbackContent: ContentSignals = {
    pageTitle: item.title,
    description,
    headings: [],
    paragraphs: description ? [description] : [],
    hasCodeBlocks: false,
    bodyText: description,
  };

  return {
    id: deriveStoryIdFromUrl(item.url, GITHUB_BLOG_SOURCE_ID),
    title: item.title,
    url: item.url,
    sourceId: GITHUB_BLOG_SOURCE_ID,
    date: item.date ?? null,
    content: fallbackContent,
  };
}

export async function ingestGithubBlogStructured(
  options?: StructuredIngestOptions,
): Promise<NormalizedStoryCandidate[]> {
  const limit = options?.limit ?? 30;
  logger.info(
    `Structured ingest [${GITHUB_BLOG_SOURCE_ID}]: scraping GitHub Blog homepage`,
  );
  const items = await scrapeGithubBlogPosts(limit);
  logger.info(
    `Structured ingest [${GITHUB_BLOG_SOURCE_ID}]: fetched ${items.length} candidates`,
  );
  return items.map(normalizeGithubBlogItem);
}


function extractSubstackUsername(entry: string): string {
  if (/^https?:\/\//.test(entry)) {
    try {
      const u = new URL(entry);
      // Remove www. if present
      let host = u.hostname.replace(/^www\./, "");
      // Remove .substack.com or .com/.dev etc.
      // If substack, take the subdomain; else, take the domain without TLD
      if (host.endsWith(".substack.com")) {
        return host.replace(/\.substack\.com$/, "");
      }
      // For custom domains, take the domain without TLD
      return host.split(".")[0];
    } catch {
      return "custom";
    }
  }
  return entry;
}

function normalizeSubstackItem(
  item: SubstackItem,
  usernameOrUrl: string,
): NormalizedStoryCandidate {
  const description = item.excerpt ?? "";
  const fallbackContent: ContentSignals = {
    pageTitle: item.title,
    description,
    headings: [],
    paragraphs: description ? [description] : [],
    hasCodeBlocks: false,
    bodyText: description,
  };

  const username = extractSubstackUsername(usernameOrUrl);
  return {
    id: deriveStoryIdFromUrl(item.url, `substack_${username}`),
    title: item.title,
    url: item.url,
    sourceId: `substack:${username}`,
    date: item.date ?? null,
    content: fallbackContent,
  };
}

/**
 * Creates a generic Substack ingestor for a given username.
 * This allows multiple Substack authors to be configured without new code.
 */
export function createSubstackIngestor(usernameOrUrl: string): StructuredIngestor {
  return async (
    options?: StructuredIngestOptions,
  ): Promise<NormalizedStoryCandidate[]> => {
    const limit = options?.limit ?? 30;
    logger.info(
      `Structured ingest [substack:${usernameOrUrl}]: scraping Substack archive`,
    );
    const items = await scrapeSubstackArchive(usernameOrUrl, limit);
    logger.info(
      `Structured ingest [substack:${usernameOrUrl}]: fetched ${items.length} candidates`,
    );
    return items.map((item) => normalizeSubstackItem(item, usernameOrUrl));
  };
}

function normalizeAddyOsmaniBlogItem(
  item: AddyOsmaniBlogItem,
): NormalizedStoryCandidate {
  const description = item.excerpt ?? "";
  const fallbackContent: ContentSignals = {
    pageTitle: item.title,
    description,
    headings: [],
    paragraphs: description ? [description] : [],
    hasCodeBlocks: false,
    bodyText: description,
  };

  return {
    id: deriveStoryIdFromUrl(item.url, ADDY_OSMANI_BLOG_SOURCE_ID),
    title: item.title,
    url: item.url,
    sourceId: ADDY_OSMANI_BLOG_SOURCE_ID,
    date: item.date ?? null,
    content: fallbackContent,
  };
}

export async function ingestAddyOsmaniBlogStructured(
  options?: StructuredIngestOptions,
): Promise<NormalizedStoryCandidate[]> {
  const limit = options?.limit ?? 30;
  logger.info(
    `Structured ingest [${ADDY_OSMANI_BLOG_SOURCE_ID}]: scraping Addy Osmani blog`,
  );
  const items = await scrapeAddyOsmaniBlog(limit);
  logger.info(
    `Structured ingest [${ADDY_OSMANI_BLOG_SOURCE_ID}]: fetched ${items.length} candidates`,
  );
  return items.map(normalizeAddyOsmaniBlogItem);
}

// Uses the first 44 bits of a SHA-256 digest to stay within JS safe integer range while keeping IDs deterministic.
export function deriveStoryIdFromUrl(url: string, source?: string): string {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 12);
  const prefix = source ? source.replace(/[^a-z0-9_-]/gi, "") : "url";
  return `${prefix}:${hash}`;
}

function parseCsvEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getSourceRegistry(): SourceCapability[] {
  const fallbackSeeds = parseCsvEnv(process.env.FALLBACK_SEED_URLS);
  const fallbackAllowlist = parseCsvEnv(process.env.FALLBACK_DOMAIN_ALLOWLIST);
  const hackernoonSeeds = parseCsvEnv(process.env.HACKERNOON_SEED_URLS);
  const hackernoonAllowlist = parseCsvEnv(
    process.env.HACKERNOON_DOMAIN_ALLOWLIST,
  );
  const githubBlogAllowlist = parseCsvEnv(
    process.env.GITHUB_BLOG_DOMAIN_ALLOWLIST,
  );
  const githubBlogEnabled =
    (process.env.ENABLE_GITHUB_BLOG ?? "true") !== "false";
  const substackUsernames = parseCsvEnv(process.env.SUBSTACK_USERNAMES);
  const addyOsmaniBlogEnabled =
    (process.env.ENABLE_ADDY_OSMANI_BLOG ?? "true") !== "false";

  const hackerNews: SourceCapability = {
    sourceId: HACKERNEWS_SOURCE_ID,
    supportsStructuredIngest: true,
    structuredIngestor: ingestHackerNewsStructured,
    fallbackBrowsingAllowed: false,
    domainAllowlist: ["news.ycombinator.com"],
  };

  const fallbackBrowsing: SourceCapability = {
    sourceId: "fallback-browse",
    supportsStructuredIngest: false,
    fallbackBrowsingAllowed: true,
    domainAllowlist: fallbackAllowlist,
    seedUrls: fallbackSeeds,
  };

  const hackernoon: SourceCapability = {
    sourceId: "hackernoon",
    supportsStructuredIngest: true,
    structuredIngestor: ingestHackernoonStructured,
    fallbackBrowsingAllowed: true,
    domainAllowlist: hackernoonAllowlist.length
      ? hackernoonAllowlist
      : ["hackernoon.com"],
    seedUrls: hackernoonSeeds.length
      ? hackernoonSeeds
      : ["https://hackernoon.com/tagged/hackernoon-top-story"],
  };

  const githubBlog: SourceCapability = {
    sourceId: GITHUB_BLOG_SOURCE_ID,
    supportsStructuredIngest: true,
    structuredIngestor: ingestGithubBlogStructured,
    fallbackBrowsingAllowed: false,
    domainAllowlist: githubBlogAllowlist.length
      ? githubBlogAllowlist
      : ["github.blog", "www.github.blog"],
  };

  const addyOsmaniBlog: SourceCapability = {
    sourceId: ADDY_OSMANI_BLOG_SOURCE_ID,
    supportsStructuredIngest: true,
    structuredIngestor: ingestAddyOsmaniBlogStructured,
    fallbackBrowsingAllowed: false,
    domainAllowlist: ["addyosmani.com", "www.addyosmani.com"],
  };

  const registry: SourceCapability[] = [];

  if (githubBlogEnabled) {
    registry.push(githubBlog);
  } else {
    logger.info(
      `[ingestion] ${GITHUB_BLOG_SOURCE_ID}: disabled via ENABLE_GITHUB_BLOG=false`,
    );
  }

  if (addyOsmaniBlogEnabled) {
    registry.push(addyOsmaniBlog);
  } else {
    logger.info(
      `[ingestion] ${ADDY_OSMANI_BLOG_SOURCE_ID}: disabled via ENABLE_ADDY_OSMANI_BLOG=false`,
    );
  }

  // Register Substack sources for each configured username
  for (const entry of substackUsernames) {
    const username = extractSubstackUsername(entry);
    let domainAllowlist: string[] = [];
    if (/^https?:\/\//.test(entry)) {
      try {
        const u = new URL(entry);
        domainAllowlist = [u.hostname.replace(/^www\./, "")];
      } catch {
        domainAllowlist = [];
      }
    } else {
      domainAllowlist = [`${username}.substack.com`];
    }
    const substackSource: SourceCapability = {
      sourceId: `substack:${username}`,
      supportsStructuredIngest: true,
      structuredIngestor: createSubstackIngestor(entry),
      fallbackBrowsingAllowed: false,
      domainAllowlist,
    };
    registry.push(substackSource);
    logger.info(
      `[ingestion] Registered Substack source for: ${entry} (username: ${username})`,
    );
  }

  registry.push(hackernoon, hackerNews, fallbackBrowsing);

  return registry;
}
