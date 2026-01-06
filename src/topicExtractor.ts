import { ContentSignals } from './contentScraper';
import logger from './logger';

const STOP_WORDS = new Set([
  'a','an','and','the','of','for','in','on','at','to','from','by','with','about','into','over','after','before','between','but','or','nor','so','yet','very','is','are','was','were','be','been','being','this','that','these','those','as','it','its','if','then','else','than','also','new','news','update'
]);

const GENERIC_TERMS = new Set([
  'tech','software','hardware','ai','ml','startup','news','story','article','release','tips','guide','tutorial','best','practices','developer','engineering','blog','post','update','api'
]);

type TopicSource = 'title' | 'url' | 'content' | 'heading';

export interface ExtractedTopics {
  candidates: string[];
  finalTopics: string[];
  confirmed: string[];
  removed: string[];
  added: string[];
}

function normalizeToken(token: string): string | null {
  const cleaned = token
    .toLowerCase()
    .replace(/[^a-z0-9\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  if (STOP_WORDS.has(cleaned)) return null;
  if (GENERIC_TERMS.has(cleaned)) return null;
  const wordCount = cleaned.split(' ').length;
  if (wordCount === 0 || wordCount > 3) return null;
  if (cleaned.length < 3) return null;
  return cleaned;
}

function buildPhrases(tokens: string[], maxPhrases: number): string[] {
  const phrases = new Set<string>();
  for (let size = 1; size <= 3; size++) {
    for (let i = 0; i <= tokens.length - size; i++) {
      const slice = tokens.slice(i, i + size).join(' ');
      const normalized = normalizeToken(slice);
      if (normalized) {
        phrases.add(normalized);
        if (phrases.size >= maxPhrases) return Array.from(phrases);
      }
    }
  }
  return Array.from(phrases);
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(token => !STOP_WORDS.has(token))
    .filter(token => token.length > 2);
}

function extractFromTitle(title: string): string[] {
  const tokens = tokenize(title);
  return buildPhrases(tokens, 10);
}

function extractFromUrl(url: string): string[] {
  try {
    const parsed = new URL(url);
    const hostBits = parsed.hostname.replace(/^(www\.|m\.|mobile\.)/, '').split('.');
    const pathBits = parsed.pathname.split('/').flatMap(segment => segment.split(/[-_]+/));
    const tokens = [...hostBits, ...pathBits].map(t => t.toLowerCase()).filter(Boolean);
    const filtered = tokens.filter(t => !STOP_WORDS.has(t) && t.length > 2);
    return buildPhrases(filtered, 6);
  } catch {
    return [];
  }
}

function dedupeKeepOrder(topics: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const topic of topics) {
    if (seen.has(topic)) continue;
    seen.add(topic);
    result.push(topic);
  }
  return result;
}

function countOccurrences(text: string, phrase: string): number {
  if (!text || !phrase) return 0;
  const pattern = new RegExp(`\\b${phrase.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'g');
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

function rankTopics(
  topics: string[],
  contentText: string,
  headingText: string
): Array<{ topic: string; score: number }> {
  const results: Array<{ topic: string; score: number }> = [];
  for (const topic of topics) {
    const freq = countOccurrences(contentText, topic);
    const headingBoost = countOccurrences(headingText, topic) > 0 ? 2 : 0;
    const lengthBoost = Math.min(topic.split(' ').length, 3) * 0.2;
    const score = freq * 2 + headingBoost + lengthBoost;
    results.push({ topic, score });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.topic.localeCompare(b.topic);
  });
  return results;
}

export function extractTopics(
  title: string,
  url: string,
  content: ContentSignals | null
): ExtractedTopics {
  const stage1Candidates = dedupeKeepOrder([...extractFromTitle(title), ...extractFromUrl(url)]).slice(0, 10);
  const contentAvailable = !!content?.bodyText;
  const contentText = (content?.bodyText || '').toLowerCase();
  const headingText = (content?.headings || []).join(' ').toLowerCase();
  const combinedText = [
    contentText,
    headingText,
    (content?.paragraphs || []).join(' ').toLowerCase(),
    (content?.description || '').toLowerCase(),
  ].join(' ');

  let candidatePool = [...stage1Candidates];

  if (contentAvailable) {
    // Drop topics not substantiated by content
    candidatePool = candidatePool.filter(topic => countOccurrences(combinedText, topic) > 0);
  }

  // Add missing topics discovered from headings/content
  const derived: string[] = [];
  const headingTokens = tokenize(headingText);
  const headingPhrases = buildPhrases(headingTokens, 8);
  for (const phrase of headingPhrases) {
    if (!stage1Candidates.includes(phrase) && countOccurrences(combinedText, phrase) > 0) {
      derived.push(phrase);
    }
  }

  const derivedTokens = tokenize(contentText);
  const derivedPhrases = buildPhrases(derivedTokens.slice(0, 60), 6);
  for (const phrase of derivedPhrases) {
    if (!stage1Candidates.includes(phrase) && !derived.includes(phrase) && countOccurrences(combinedText, phrase) > 1) {
      derived.push(phrase);
    }
  }

  let refinedPool = dedupeKeepOrder([...candidatePool, ...derived]);
  if (refinedPool.length === 0) {
    refinedPool = stage1Candidates.slice(0, 5);
  }

  const ranked = rankTopics(refinedPool, combinedText, headingText);
  const finalTopics = ranked
    .slice(0, 7)
    .map(r => r.topic)
    .filter(Boolean);

  const trimmedFinal = finalTopics.length >= 3 ? finalTopics : finalTopics.concat(stage1Candidates).slice(0, 3);

  const removed = stage1Candidates.filter(t => !trimmedFinal.includes(t));
  const confirmed = trimmedFinal.filter(t => stage1Candidates.includes(t));
  const added = trimmedFinal.filter(t => !stage1Candidates.includes(t));

  logger.info(`Topic extraction — candidates: ${stage1Candidates.join(', ') || 'none'}`);
  if (!contentAvailable) {
    logger.warn('Content not available; using title/URL-only topics.');
  }
  if (removed.length > 0) {
    logger.info(`Removed topics after content review: ${removed.join(', ')}`);
  }
  if (added.length > 0) {
    logger.info(`Added topics from content: ${added.join(', ')}`);
  }

  return {
    candidates: stage1Candidates,
    finalTopics: trimmedFinal,
    confirmed,
    removed,
    added,
  };
}
