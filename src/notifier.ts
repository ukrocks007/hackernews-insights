import dotenv from 'dotenv';
import { StoredStory } from './storage';
import { buildSignedFeedbackLink, toDisplayScore } from './feedback';

dotenv.config();

const PUSHOVER_USER_KEY = process.env.PUSHOVER_USER_KEY;
const PUSHOVER_API_TOKEN = process.env.PUSHOVER_API_TOKEN;
const PUSHOVER_URL = 'https://api.pushover.net/1/messages.json';
let warnedMissingSecret = false;
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendNotification(message: string, title: string = 'HN Insights'): Promise<void> {
  if (!PUSHOVER_USER_KEY || !PUSHOVER_API_TOKEN) {
    console.warn('Pushover credentials not found. Skipping notification.');
    console.log(`[Notification] ${title}: ${message}`);
    return;
  }

  try {
    const response = await fetch(PUSHOVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: PUSHOVER_API_TOKEN,
        user: PUSHOVER_USER_KEY,
        message: message,
        title: title,
        html: 1
      })
    });
    
    if (!response.ok) {
      throw new Error(`Pushover API error: ${response.status}`);
    }
    
    console.log('Notification sent successfully.');
  } catch (error) {
    console.error('Error sending notification:', error);
  }
}

function feedbackLinks(storyId: number): string {
  const actions: Array<{ label: string; action: 'LIKE' | 'DISLIKE' | 'SAVE' }> = [
    { label: '👍 Relevant', action: 'LIKE' },
    { label: '👎 Not relevant', action: 'DISLIKE' },
    { label: '📌 Save for later', action: 'SAVE' },
  ];

  const rendered = actions
    .map(({ label, action }) => {
      const url = buildSignedFeedbackLink(storyId, action);
      if (!url) {
        if (!warnedMissingSecret) {
          console.warn('Feedback secret is missing; feedback links will be skipped.');
          warnedMissingSecret = true;
        }
        return null;
      }
      return `<a href="${url}">${escapeHtml(label)}</a>`;
    })
    .filter(Boolean)
    .join(' | ');

  return rendered ? `\n${rendered}` : '';
}

export async function sendStoryNotification(story: StoredStory): Promise<void> {
  const message =
    `<b><a href="${story.url}">${story.title}</a></b>\n` +
    `<i>${story.reason ?? 'Highly relevant to your interests'}</i>\n` +
    `(Relevance: ${toDisplayScore(story.relevanceScore)}, Score: ${story.score ?? 0})` +
    feedbackLinks(story.id);

  await sendNotification(message, 'HN Insight');
}

export async function sendDailySummary(stories: StoredStory[]): Promise<void> {
  // Deprecated in favor of individual notifications, but kept for compatibility if needed
  if (stories.length === 0) return;
  
  for (const story of stories) {
    await sendStoryNotification(story);
    // Small delay to prevent rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

export async function sendErrorNotification(error: Error): Promise<void> {
  await sendNotification(`System failed: ${error.message}`, 'HN Insights - ERROR');
}
