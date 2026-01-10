import { chromium } from 'playwright';
import logger from './logger';

export interface GithubBlogItem {
  title: string;
  url: string;
  date?: string | null;
  excerpt?: string | null;
}

const GITHUB_BLOG_URL = 'https://github.blog/';

export async function scrapeGithubBlogPosts(limit: number = 30): Promise<GithubBlogItem[]> {
  logger.info(`[${GITHUB_BLOG_URL}] Starting scrape (limit=${limit})`);

  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  });

  await context.route('**/*.{png,jpg,jpeg,gif,webp,svg,mp4,mp3,woff,woff2,ttf}', route => route.abort());

  const page = await context.newPage();
  page.setDefaultNavigationTimeout(30000);
  page.setDefaultTimeout(15000);

  try {
    await page.goto(GITHUB_BLOG_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const items = await page
      .$$eval(
        'article',
        (articles, max) => {
          const results: Array<{ title: string; url: string; date?: string | null; excerpt?: string | null }> = [];
          const seen = new Set<string>();

          for (const article of articles) {
            const link = article.querySelector('a[href]');
            if (!link) continue;

            let href = (link as HTMLAnchorElement).getAttribute('href') || '';
            try {
              href = new URL(href, window.location.origin).toString();
            } catch {
              continue;
            }

            if (!href.includes('github.blog')) continue;
            if (seen.has(href)) continue;
            seen.add(href);

            const titleEl = article.querySelector('h1, h2, h3');
            const rawTitle = titleEl?.textContent?.trim() || link.textContent?.trim() || href;
            if (!rawTitle) continue;

            const timeEl = article.querySelector('time');
            const date = timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || null;
            const excerptEl = article.querySelector('p');
            const excerpt = excerptEl?.textContent?.trim() || null;

            results.push({
              title: rawTitle,
              url: href,
              date,
              excerpt,
            });

            if (results.length >= (max as number)) break;
          }

          return results;
        },
        limit
      )
      .catch(() => [] as GithubBlogItem[]);

    logger.info(`[${GITHUB_BLOG_URL}] Scraped ${items.length} posts`);
    return items;
  } catch (err) {
    logger.error(`Error scraping GitHub Blog: ${err}`);
    return [];
  } finally {
    await browser.close();
  }
}
