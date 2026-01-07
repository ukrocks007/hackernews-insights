import crypto from 'crypto';
import { FeedbackEvent, Story } from '@prisma/client';
import { getPrismaClient } from './prismaClient';
import logger from './logger';

export type FeedbackAction = 'LIKE' | 'DISLIKE' | 'SAVE' | 'OPENED' | 'IGNORED';
export type FeedbackConfidence = 'explicit' | 'implicit';
export type FeedbackSource = 'pushover' | 'system' | 'dashboard';

const EXPLICIT_WEIGHTS: Record<FeedbackAction, number> = {
  LIKE: 1.0,
  DISLIKE: -1.0,
  SAVE: 1.5,
  OPENED: 0,
  IGNORED: 0,
};

const IMPLICIT_WEIGHTS: Record<FeedbackAction, number> = {
  LIKE: 0,
  DISLIKE: 0,
  SAVE: 0,
  OPENED: 0.3,
  IGNORED: -0.2,
};

export const SCORE_SCALE = 100;
const DECAY_HALF_LIFE_HOURS = 36;
const SUPPRESSION_THRESHOLD = -150; // scaled score
const MIN_SUPPRESSION_HOURS = 6;
const MAX_SUPPRESSION_HOURS = 48;
const SUPPRESSION_HOURS_PER_POINT = 2;
const TAG_ADJUSTMENT_FACTOR = 0.1;
const SOURCE_ADJUSTMENT_FACTOR = 0.05;
export const INITIAL_RELEVANCE_SCORE = 150;
// Default contribution used when associating topics to new stories.
export const DEFAULT_TOPIC_WEIGHT_RATIO = 0.3;
const TOPIC_IMPLICIT_SCALE = 0.4;
const TOPIC_EXPLICIT_SCALE = 0.7;

export const FEEDBACK_ACTIONS: FeedbackAction[] = ['LIKE', 'DISLIKE', 'SAVE', 'OPENED', 'IGNORED'];

export interface FeedbackPayload {
  storyId: string;
  action: FeedbackAction;
  confidence: FeedbackConfidence;
  source: FeedbackSource;
  metadata?: Record<string, unknown>;
}

export interface RelevanceComputation {
  relevanceScore: number;
  suppressedUntil: Date | null;
  reasons: string[];
}

function getSecret(): string | null {
  return process.env.FEEDBACK_SECRET || process.env.PUSHOVER_API_TOKEN || null;
}

function buildSigningPayload(
  storyId: string,
  action: FeedbackAction,
  confidence: FeedbackConfidence,
  source: FeedbackSource,
  timestamp: number,
): string {
  return `${storyId}:${action}:${confidence}:${source}:${timestamp}`;
}

export function buildSignedFeedbackLink(
  storyId: string,
  action: FeedbackAction,
  baseUrl?: string,
  confidence: FeedbackConfidence = 'explicit',
  source: FeedbackSource = 'pushover',
  timestamp: number = Date.now(),
): string | null {
  const secret = getSecret();
  if (!secret) {
    return null;
  }

  const payload = buildSigningPayload(storyId, action, confidence, source, timestamp);
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  const configuredBase = baseUrl || process.env.FEEDBACK_BASE_URL;
  const fallbackBase = `http://localhost:${process.env.FEEDBACK_PORT || 3000}`;
  const normalizedBase = (configuredBase || fallbackBase).replace(/\/$/, '');
  const url = new URL(`${normalizedBase}/api/feedback`);
  url.searchParams.set('storyId', storyId.toString());
  url.searchParams.set('action', action);
  url.searchParams.set('confidence', confidence);
  url.searchParams.set('source', source);
  url.searchParams.set('ts', timestamp.toString());
  url.searchParams.set('sig', sig);

  return url.toString();
}

export function verifyFeedbackSignature(
  storyId: string,
  action: FeedbackAction,
  confidence: FeedbackConfidence,
  source: FeedbackSource,
  timestamp: number,
  signature: string,
  ttlHours: number,
): boolean {
  const secret = getSecret();
  if (!secret) return false;

  const now = Date.now();
  const ttlMs = ttlHours * 60 * 60 * 1000;
  if (timestamp > now) return false;
  if (now - timestamp > ttlMs) return false;

  const payload = buildSigningPayload(storyId, action, confidence, source, timestamp);
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  const provided = Buffer.from(signature, 'hex');

  if (expected.length !== provided.length) return false;

  return crypto.timingSafeEqual(expected, provided);
}

function decayFactor(createdAt: Date): number {
  const rawHoursAgo = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
  if (rawHoursAgo < 0) {
    logger.warn('decayFactor: createdAt is in the future', {
      createdAt: createdAt.toISOString(),
      now: new Date().toISOString(),
    });
  }
  const hoursAgo = Math.max(0, rawHoursAgo);
  const lambda = Math.log(2) / DECAY_HALF_LIFE_HOURS;
  return Math.exp(-lambda * hoursAgo);
}

function calculateSuppressionHours(score: number): number {
  return Math.min(
    MAX_SUPPRESSION_HOURS,
    Math.max(MIN_SUPPRESSION_HOURS, Math.round(Math.abs(score) / SCORE_SCALE) * SUPPRESSION_HOURS_PER_POINT)
  );
}

export function toDisplayScore(relevanceScore: number): string {
  return (relevanceScore / SCORE_SCALE).toFixed(2);
}

export function computeRelevanceScore(story: Story, feedbackEvents: FeedbackEvent[]): RelevanceComputation {
  let aggregate = story.relevanceScore ?? SCORE_SCALE; // baseline equivalent to 1.0 when scaled
  let suppressedUntil: Date | null = story.suppressedUntil ?? null;
  const reasons: string[] = [];
  const tagTotals = new Map<string, number>();
  const sourceTotals = new Map<string, number>();
  const storyHost = story.url
    ? (() => {
        const rawUrl = story.url.trim();
        try {
          return new URL(rawUrl).hostname.replace(/^(www\.|m\.|mobile\.)/, '');
        } catch (firstError) {
          const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(rawUrl);
          const normalizedUrl = hasScheme ? rawUrl : `https://${rawUrl}`;
          try {
            return new URL(normalizedUrl).hostname.replace(/^(www\.|m\.|mobile\.)/, '');
          } catch (secondError) {
            logger.warn(
              `Invalid story URL '${story.url}' for domain extraction (story ${story.id}) after normalization:`,
              secondError,
            );
          }
          return null;
        }
      })()
    : null;

  for (const event of feedbackEvents) {
    const action = event.action as FeedbackAction;
    if (!FEEDBACK_ACTIONS.includes(action)) continue;

    const weight =
      event.confidence === 'implicit'
        ? IMPLICIT_WEIGHTS[action] || 0
        : EXPLICIT_WEIGHTS[action] || 0;
    if (weight === 0) continue;

    const decay = decayFactor(event.createdAt);
    const contribution = weight * SCORE_SCALE * decay;
    aggregate += contribution;
    reasons.push(`${action} (${event.confidence}) x${decay.toFixed(2)} => ${contribution.toFixed(0)}`);

    if (storyHost) {
      tagTotals.set(storyHost, (tagTotals.get(storyHost) || 0) + contribution);
    }
    sourceTotals.set(event.source, (sourceTotals.get(event.source) || 0) + contribution);
  }

  const tagAdjustment = Array.from(tagTotals.values()).reduce((sum, value) => sum + value * TAG_ADJUSTMENT_FACTOR, 0);
  if (tagAdjustment !== 0) {
    aggregate += tagAdjustment;
    reasons.push(`Domain bias applied: ${tagAdjustment.toFixed(0)}`);
  }

  const sourceAdjustment = Array.from(sourceTotals.values()).reduce((sum, value) => sum + value * SOURCE_ADJUSTMENT_FACTOR, 0);
  if (sourceAdjustment !== 0) {
    aggregate += sourceAdjustment;
    reasons.push(`Source bias applied: ${sourceAdjustment.toFixed(0)}`);
  }

  const roundedScore = Math.round(aggregate);
  if (roundedScore < SUPPRESSION_THRESHOLD) {
    // Suppress temporarily but allow rebound after decay
    const hours = calculateSuppressionHours(roundedScore);
    suppressedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
    reasons.push(`Suppressed for ${hours}h due to low relevance (${toDisplayScore(roundedScore)})`);
  } else if (roundedScore > 0 && suppressedUntil !== null && suppressedUntil > new Date()) {
    // Clear suppression if score recovered
    suppressedUntil = null;
    reasons.push('Suppression cleared after positive feedback');
  }

  return { relevanceScore: roundedScore, suppressedUntil, reasons };
}

export async function recordFeedbackEvent(payload: FeedbackPayload): Promise<RelevanceComputation | null> {
  const prisma = getPrismaClient();
  try {
    await prisma.feedbackEvent.create({
      data: {
        storyId: payload.storyId,
        action: payload.action,
        confidence: payload.confidence,
        source: payload.source,
        // Stored as string because SQLite connector lacks native Json support in this Prisma version.
        metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
      },
    });

    const story = await prisma.story.findUnique({
      where: { id: payload.storyId },
      include: { feedbackEvents: true },
    });

    if (!story) return null;

    const computation = computeRelevanceScore(story, story.feedbackEvents);
    await prisma.story.update({
      where: { id: story.id },
      data: {
        relevanceScore: computation.relevanceScore,
        suppressedUntil: computation.suppressedUntil ?? null,
      },
    });

    const weightMap = payload.confidence === 'implicit' ? IMPLICIT_WEIGHTS : EXPLICIT_WEIGHTS;
    const topicDelta = weightMap[payload.action] ?? 0;
    if (topicDelta !== 0) {
      const scaled = Math.round(
        topicDelta * SCORE_SCALE * (payload.confidence === 'implicit' ? TOPIC_IMPLICIT_SCALE : TOPIC_EXPLICIT_SCALE)
      );
      const links = await prisma.storyTopic.findMany({ where: { storyId: payload.storyId } });
      const topicIds = links.map(link => link.topicId);
      if (topicIds.length > 0) {
        await prisma.topic.updateMany({
          where: { id: { in: topicIds } },
          data: { score: { increment: scaled } },
        });
      }
    }
    return computation;
  } catch (error) {
    logger.error('Failed to record feedback event', error);
    return null;
  }
}
