import { FeedbackEvent, Story } from '@prisma/client';
import { computeRelevanceScore, DEFAULT_TOPIC_WEIGHT_RATIO, SCORE_SCALE } from './feedback';
import { disconnectPrisma, getPrismaClient, initPrisma } from './prismaClient';
import logger from './logger';

export type StoredStory = Story;

export interface StoryInput {
  id: number;
  title: string;
  url?: string | null;
  score?: number | null;
  rank?: number | null;
  date: string;
  reason?: string | null;
  relevanceScore?: number; // defaults to SCORE_SCALE when omitted
  notificationSent?: boolean;
}

export interface TopicInput {
  name: string;
  source: 'title' | 'content' | 'metadata';
  weight?: number;
}

// New stories start at SCORE_SCALE (represents a baseline relevance of 1.0)
const DEFAULT_RELEVANCE_SCORE = SCORE_SCALE;
const UNIQUE_CONSTRAINT_ERROR = 'P2002';
const ALLOWED_TOPIC_SOURCES = new Set(['title', 'content', 'metadata']);

function getErrorCode(error: unknown): string | null {
  if (typeof error === 'object' && error && 'code' in error) {
    const withCode = error as { code?: unknown };
    return typeof withCode.code === 'string' ? withCode.code : null;
  }
  return null;
}

export async function initDB(): Promise<void> {
  await initPrisma();
}

function normalizeTopicName(topic: string): string {
  return topic.trim().toLowerCase();
}

async function persistTopicsForStory(storyId: number, topics: TopicInput[]): Promise<void> {
  if (!topics.length) return;
  const prisma = getPrismaClient();

  for (const topic of topics) {
    const name = normalizeTopicName(topic.name);
    if (!name) continue;

    const weight = topic.weight ?? Math.round(SCORE_SCALE * DEFAULT_TOPIC_WEIGHT_RATIO);
    const source = ALLOWED_TOPIC_SOURCES.has(topic.source) ? topic.source : 'metadata';
    const topicRecord = await prisma.topic.upsert({
      where: { name },
      update: { score: { increment: weight } },
      create: { name, score: weight },
    });

    try {
      await prisma.storyTopic.create({
        data: {
          storyId,
          topicId: topicRecord.id,
          source,
          weight,
        },
      });
    } catch (error: unknown) {
      const code = getErrorCode(error);
      if (code !== UNIQUE_CONSTRAINT_ERROR) {
        logger.error(`Unexpected error while saving story topic for ${storyId}/${name}: ${error}`);
        throw error;
      }
      logger.info(`Duplicate story-topic link ignored for ${storyId}/${name}`);
    }
  }
}

export async function saveStory(story: StoryInput, topics: TopicInput[] = []): Promise<void> {
  const prisma = getPrismaClient();
  try {
    await prisma.story.create({
      data: {
        id: story.id,
        title: story.title,
        url: story.url,
        score: story.score ?? null,
        rank: story.rank ?? null,
        date: story.date,
        reason: story.reason ?? null,
        relevanceScore: story.relevanceScore ?? DEFAULT_RELEVANCE_SCORE,
        notificationSent: story.notificationSent ?? false,
      },
    });
    await persistTopicsForStory(story.id, topics);
  } catch (error: unknown) {
    const code = getErrorCode(error);
    if (code === UNIQUE_CONSTRAINT_ERROR) {
      // Duplicate, ignore to preserve INSERT OR IGNORE semantics
      return;
    }
    logger.error(`Unexpected error while saving story ${story.id}: ${error}`);
    throw error;
  }
}

function withoutRelations(story: Story & { feedbackEvents?: FeedbackEvent[] }): Story {
  if (!('feedbackEvents' in story)) {
    return story;
  }
  const { feedbackEvents: _feedbackEvents, ...rest } = story;
  return rest as Story;
}

async function refreshRelevance(story: Story & { feedbackEvents: FeedbackEvent[] }): Promise<Story & { feedbackEvents: FeedbackEvent[] }> {
  const prisma = getPrismaClient();
  const computation = computeRelevanceScore(story, story.feedbackEvents);
  const currentSuppression = story.suppressedUntil?.getTime() ?? null;
  const nextSuppression = computation.suppressedUntil?.getTime() ?? null;

  if (
    computation.relevanceScore !== story.relevanceScore ||
    currentSuppression !== nextSuppression
  ) {
    if (computation.suppressedUntil && !story.suppressedUntil) {
      logger.info(`Story ${story.id} temporarily suppressed until ${computation.suppressedUntil.toISOString()}`);
    }
    if (!computation.suppressedUntil && story.suppressedUntil) {
      logger.info(`Story ${story.id} suppression cleared after feedback recovery`);
    }
    const updated = await prisma.story.update({
      where: { id: story.id },
      data: {
        relevanceScore: computation.relevanceScore,
        suppressedUntil: computation.suppressedUntil ?? null,
      },
    });

    const updatedStory: Story & { feedbackEvents: FeedbackEvent[] } = {
      ...updated,
      feedbackEvents: story.feedbackEvents,
    };
    return updatedStory;
  }

  return story;
}

export async function getUnsentRelevantStories(): Promise<Story[]> {
  const prisma = getPrismaClient();
  const stories = await prisma.story.findMany({
    where: {
      notificationSent: false,
      OR: [{ suppressedUntil: null }, { suppressedUntil: { lte: new Date() } }],
    },
    include: { feedbackEvents: true },
  });

  // Sequential to avoid hammering SQLite with concurrent writes during refresh.
  const refreshedStories: Array<Story & { feedbackEvents: FeedbackEvent[] }> = [];
  for (const story of stories) {
    refreshedStories.push(await refreshRelevance(story));
  }
  const normalized = refreshedStories.map(withoutRelations);
  normalized.sort((a, b) => {
    if (b.relevanceScore !== a.relevanceScore) {
      return (b.relevanceScore || 0) - (a.relevanceScore || 0);
    }
    return (b.score || 0) - (a.score || 0);
  });
  return normalized;
}

export async function markStoryAsSent(id: number): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.story.update({
    where: { id },
    data: { notificationSent: true, lastNotifiedAt: new Date() },
  });
}

export async function hasStoryBeenProcessed(id: number): Promise<boolean> {
  const prisma = getPrismaClient();
  const result = await prisma.story.findUnique({ where: { id } });
  return !!result;
}

export async function getStoriesForDate(date: string): Promise<Story[]> {
  const prisma = getPrismaClient();
  return prisma.story.findMany({ where: { date } });
}

export async function closeDB(): Promise<void> {
  await disconnectPrisma();
}
