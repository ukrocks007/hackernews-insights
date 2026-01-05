import { FeedbackEvent, Story } from '@prisma/client';
import { computeRelevanceScore } from './feedback';
import { disconnectPrisma, getPrismaClient, initPrisma } from './prismaClient';

export type StoredStory = Story;

export interface StoryInput {
  id: number;
  title: string;
  url?: string | null;
  score?: number | null;
  rank?: number | null;
  date: string;
  reason?: string | null;
  relevanceScore?: number;
  notificationSent?: boolean;
}

const BASE_RELEVANCE_SCORE = 100;

export async function initDB(): Promise<void> {
  await initPrisma();
}

export async function saveStory(story: StoryInput): Promise<void> {
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
        relevanceScore: story.relevanceScore ?? BASE_RELEVANCE_SCORE,
        notificationSent: story.notificationSent ?? false,
      },
    });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      // Duplicate, ignore to preserve INSERT OR IGNORE semantics
      return;
    }
    throw error;
  }
}

function withoutRelations(story: Story & { feedbackEvents?: FeedbackEvent[] }): Story {
  const { feedbackEvents: _events, ...rest } = story;
  return rest;
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
      console.log(`Story ${story.id} temporarily suppressed until ${computation.suppressedUntil.toISOString()}`);
    }
    if (!computation.suppressedUntil && story.suppressedUntil) {
      console.log(`Story ${story.id} suppression cleared after feedback recovery`);
    }
    const updated = await prisma.story.update({
      where: { id: story.id },
      data: {
        relevanceScore: computation.relevanceScore,
        suppressedUntil: computation.suppressedUntil ?? null,
      },
    });

    return { ...updated, feedbackEvents: story.feedbackEvents };
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
    orderBy: [{ relevanceScore: 'desc' }, { score: 'desc' }],
  });

  const refreshed: Story[] = [];
  for (const story of stories) {
    const updated = await refreshRelevance(story);
    refreshed.push(withoutRelations(updated));
  }
  refreshed.sort((a, b) => {
    if (b.relevanceScore !== a.relevanceScore) {
      return (b.relevanceScore || 0) - (a.relevanceScore || 0);
    }
    return (b.score || 0) - (a.score || 0);
  });
  return refreshed;
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
