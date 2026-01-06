import { chromium, Browser, Page } from 'playwright';
import dotenv from 'dotenv';
import logger from './logger';

dotenv.config();

export interface ScrapedStory {
  id: number;
  title: string;
  url: string;
  score: number;
  rank: number;
}

export async function scrapeTopStories(count: number = 30, pageNumber: number = 1): Promise<ScrapedStory[]> {
  logger.info(`Launching browser for page ${pageNumber}...`);
  const browser: Browser = await chromium.launch({
    headless: process.env.HEADLESS !== 'false', // Default to true
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });

  const page: Page = await context.newPage();
  const stories: ScrapedStory[] = [];

  try {
    const url = pageNumber === 1 ? 'https://news.ycombinator.com/' : `https://news.ycombinator.com/news?p=${pageNumber}`;
    logger.info(`Navigating to Hacker News (Page ${pageNumber})...`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Wait for the main table to load
    await page.waitForSelector('#hnmain');

    logger.info('Extracting stories...');
    
    // HN structure: 
    // <tr class="athing" id="38876543">...</tr>
    // <tr><td colspan="2"></td><td class="subtext">...</td></tr>
    
    const storyRows = await page.$$('.athing');
    
    for (let i = 0; i < Math.min(count, storyRows.length); i++) {
      const row = storyRows[i];
      
      // Extract ID
      const idStr = await row.getAttribute('id');
      const id = idStr ? parseInt(idStr, 10) : 0;
      
      // Extract Rank
      const rankEl = await row.$('.rank');
      const rankText = rankEl ? await rankEl.innerText() : '0.';
      const rank = parseInt(rankText.replace('.', ''), 10);
      
      // Extract Title and URL
      const titleEl = await row.$('.titleline > a');
      if (!titleEl) continue;
      
      const title = await titleEl.innerText();
      let url = await titleEl.getAttribute('href') || '';
      
      // Handle relative URLs (Ask HN, etc.)
      if (url.startsWith('item?id=')) {
        url = `https://news.ycombinator.com/${url}`;
      }

      // Extract Score (need to look at the next row)
      // We can find the subtext row by looking for the next sibling tr of the current row
      // Or simpler: select based on the score span which has an id `score_<id>`
      const scoreEl = await page.$(`#score_${id}`);
      let score = 0;
      if (scoreEl) {
        const scoreText = await scoreEl.innerText();
        score = parseInt(scoreText.split(' ')[0], 10);
      }

      stories.push({
        id,
        title,
        url,
        score,
        rank
      });
    }
    
    logger.info(`Extracted ${stories.length} stories.`);
    
  } catch (error) {
    logger.error(`Error scraping HN: ${error}`);
    throw error;
  } finally {
    await browser.close();
  }

  return stories;
}
