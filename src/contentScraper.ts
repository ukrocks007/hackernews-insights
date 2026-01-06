import { chromium, Browser } from 'playwright';
import logger from './logger';

export interface ContentSignals {
  pageTitle: string;
  description: string;
  headings: string[];
  paragraphs: string[];
  hasCodeBlocks: boolean;
}

export async function scrapeStoryContent(url: string): Promise<ContentSignals | null> {
  // Skip PDF or non-web pages to save time
  if (url.match(/\.(pdf|png|jpg|mp4)$/i)) {
    logger.info(`Skipping non-HTML URL: ${url}`);
    return null;
  }

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (compatible; HNInsights/1.0; +http://example.com)',
      viewport: { width: 1280, height: 720 }
    });
    
    // Block heavy resources
    await context.route('**/*.{png,jpg,jpeg,gif,webp,svg,css,woff,woff2,mp4,mp3}', route => route.abort());

    const page = await context.newPage();
    
    // Hard timeout 30s
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Extract signals
    const pageTitle = await page.title();
    
    const description = await page.$eval('meta[name="description"]', el => el.getAttribute('content'))
      .catch(() => page.$eval('meta[property="og:description"]', el => el.getAttribute('content')))
      .catch(() => '') || '';

    // Get headings (h1, h2) - max 5
    const headings = await page.$$eval('h1, h2', els => 
      els.map(el => (el as HTMLElement).innerText.trim())
         .filter(t => t.length > 0)
         .slice(0, 5)
    );
    
    // Get paragraphs - heuristic: length > 60 chars
    const paragraphs = await page.$$eval('p', els => {
      return els.map(el => (el as HTMLElement).innerText.trim())
        .filter(t => t.length > 60) 
        .slice(0, 3);
    });

    const hasCodeBlocks = await page.$('pre code, .highlight, .code') !== null;

    return {
      pageTitle: pageTitle.slice(0, 100),
      description: (description as string).slice(0, 200),
      headings: headings.map(h => h.slice(0, 100)),
      paragraphs: paragraphs.map(p => p.slice(0, 300)),
      hasCodeBlocks
    };

  } catch (error) {
    logger.error(`Error scraping content for ${url}: ${error}`);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}
