import axios from 'axios';
import dotenv from 'dotenv';
import { Story } from './storage';

dotenv.config();

const PUSHOVER_USER_KEY = process.env.PUSHOVER_USER_KEY;
const PUSHOVER_API_TOKEN = process.env.PUSHOVER_API_TOKEN;
const PUSHOVER_URL = 'https://api.pushover.net/1/messages.json';

export async function sendNotification(message: string, title: string = 'HN Insights'): Promise<void> {
  if (!PUSHOVER_USER_KEY || !PUSHOVER_API_TOKEN) {
    console.warn('Pushover credentials not found. Skipping notification.');
    console.log(`[Notification] ${title}: ${message}`);
    return;
  }

  try {
    await axios.post(PUSHOVER_URL, {
      token: PUSHOVER_API_TOKEN,
      user: PUSHOVER_USER_KEY,
      message: message,
      title: title,
      html: 1
    });
    console.log('Notification sent successfully.');
  } catch (error) {
    console.error('Error sending notification:', error);
  }
}

export async function sendStoryNotification(story: Story): Promise<void> {
  const message = `<b><a href="${story.url}">${story.title}</a></b>\n` +
                  `<i>${story.reason}</i>\n` +
                  `(Relevance: ${story.relevance_score}/10, Score: ${story.score})`;
  
  await sendNotification(message, 'HN Insight');
}

export async function sendDailySummary(stories: Story[]): Promise<void> {
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
