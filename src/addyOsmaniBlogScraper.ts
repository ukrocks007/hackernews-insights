import { chromium } from 'playwright';
import logger from './logger';

export interface AddyOsmaniBlogItem {
  title: string;
  url: string;
  date?: string | null;
  excerpt?: string | null;
}

const ADDY_OSMANI_BLOG_URL = 'https://addyosmani.com/blog/';

/**
 * Scrapes Addy Osmani's personal blog for recent posts.
 * @param limit - Maximum number of posts to scrape
 * @returns Array of blog post items with title, url, date, and excerpt
 */
export async function scrapeAddyOsmaniBlog(limit: number = 30): Promise<AddyOsmaniBlogItem[]> {
  logger.info(`[AddyOsmaniBlog] Starting scrape from ${ADDY_OSMANI_BLOG_URL} (limit=${limit})`);

  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  });

  // Block heavy assets for faster scraping
  await context.route('**/*.{png,jpg,jpeg,gif,webp,svg,mp4,mp3,woff,woff2,ttf}', route => route.abort());

  const page = await context.newPage();
  page.setDefaultNavigationTimeout(30000);
  page.setDefaultTimeout(15000);

  try {
    await page.goto(ADDY_OSMANI_BLOG_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait a moment for any dynamic content
    await page.waitForTimeout(2000);

    // Look for blog post entries - Addy's blog uses article.card structure
    const items = await page
      .$$eval(
        'article.card, .card',
        (elements, max) => {
          const results: Array<{ title: string; url: string; date?: string | null; excerpt?: string | null }> = [];
          const seen = new Set<string>();

          for (const el of elements) {
            // Find the main link - could be in h3.card-title or directly on the article
            const titleLink = el.querySelector('.card-title a, h3 a, a[href*="/blog/"]') as HTMLAnchorElement;
            if (!titleLink) continue;

            const href = titleLink.href;
            if (!href || seen.has(href)) continue;

            // Filter for actual blog post URLs (not navigation, social, etc.)
            try {
              const url = new URL(href);
              if (!url.hostname.includes('addyosmani.com')) continue;
              
              // Skip navigation and non-article links
              if (href.includes('/tag/') || href.includes('/category/') || href === 'https://addyosmani.com/blog/' || href === 'https://addyosmani.com/blog') continue;
            } catch {
              continue;
            }

            seen.add(href);

            // Extract title from card-title or heading
            const headingEl = el.querySelector('.card-title, h3, h2, h1');
            const titleText = headingEl?.textContent?.trim() || titleLink.textContent?.trim() || titleLink.title?.trim() || '';
            
            if (!titleText || titleText.length < 3) continue;

            // Look for date - typically in time.card-date
            let date: string | null = null;
            const timeEl = el.querySelector('time.card-date, time, .card-date');
            if (timeEl) {
              date = timeEl.getAttribute('datetime') || timeEl.textContent?.trim() || null;
            } else {
              // Look for date-like text patterns
              const datePattern = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{4}\b|\d{4}-\d{2}-\d{2}/i;
              const textContent = el.textContent || '';
              const dateMatch = textContent.match(datePattern);
              if (dateMatch) {
                date = dateMatch[0];
              }
            }

            // Look for excerpt/description - typically in card-description
            let excerpt: string | null = null;
            const excerptEl = el.querySelector('.card-description, p, .excerpt, .description, .summary');
            if (excerptEl && excerptEl !== titleLink && !excerptEl.contains(titleLink)) {
              excerpt = excerptEl.textContent?.trim() || null;
              if (excerpt && excerpt.length < 5) excerpt = null; // Skip empty descriptions
            }

            results.push({
              title: titleText.slice(0, 300),
              url: href,
              date,
              excerpt: excerpt?.slice(0, 500) || null,
            });

            if (results.length >= (max as number)) break;
          }

          return results;
        },
        limit
      )
      .catch(() => [] as AddyOsmaniBlogItem[]);

    logger.info(`[AddyOsmaniBlog] Scraped ${items.length} posts`);
    return items;
  } catch (err) {
    logger.error(`Error scraping Addy Osmani blog: ${err}`);
    return [];
  } finally {
    await browser.close();
  }
}
