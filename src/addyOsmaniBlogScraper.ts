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

    // Look for blog post entries - typically articles, list items, or divs with links
    const items = await page
      .$$eval(
        'article, .post, .blog-post, li, div',
        (elements, max) => {
          const results: Array<{ title: string; url: string; date?: string | null; excerpt?: string | null }> = [];
          const seen = new Set<string>();

          for (const el of elements) {
            // Find a link within this element
            const link = el.querySelector('a[href]') as HTMLAnchorElement;
            if (!link) continue;

            const href = link.href;
            if (!href || seen.has(href)) continue;

            // Filter for actual blog post URLs (not navigation, social, etc.)
            // Typically blog posts will be on the same domain
            try {
              const url = new URL(href);
              if (!url.hostname.includes('addyosmani.com')) continue;
              
              // Skip navigation and non-article links
              if (href.includes('/tag/') || href.includes('/category/') || href === ADDY_OSMANI_BLOG_URL) continue;
            } catch {
              continue;
            }

            seen.add(href);

            // Extract title - could be from heading, link text, or title attribute
            const headingEl = el.querySelector('h1, h2, h3, h4');
            const titleText = headingEl?.textContent?.trim() || link.textContent?.trim() || link.title?.trim() || '';
            
            if (!titleText || titleText.length < 3) continue;

            // Look for date
            let date: string | null = null;
            const timeEl = el.querySelector('time');
            if (timeEl) {
              date = timeEl.getAttribute('datetime') || timeEl.textContent?.trim() || null;
            } else {
              // Look for date-like text patterns
              const datePattern = /\d{4}-\d{2}-\d{2}|\d{1,2}\s+\w+\s+\d{4}/;
              const textContent = el.textContent || '';
              const dateMatch = textContent.match(datePattern);
              if (dateMatch) {
                date = dateMatch[0];
              }
            }

            // Look for excerpt/description
            let excerpt: string | null = null;
            const excerptEl = el.querySelector('p, .excerpt, .description, .summary');
            if (excerptEl && excerptEl !== link && !excerptEl.contains(link)) {
              excerpt = excerptEl.textContent?.trim() || null;
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
