import { chromium } from 'playwright';
import logger from './logger';

export interface HackernoonItem {
  title: string;
  url: string;
}

export async function scrapeTaggedStories(tagUrl: string = 'https://hackernoon.com/tagged/hackernoon-top-story', limit: number = 30, pageNum: number = 1): Promise<HackernoonItem[]> {
  const url = pageNum === 1 ? tagUrl : `${tagUrl}?page=${pageNum}`;
  logger.info(`Scraping Hackernoon tag page: ${url}`);

  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });

//   await context.route('**/*.{png,jpg,jpeg,gif,webp,svg,css,woff,woff2,mp4,mp3}', route => route.abort());

  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Collect candidate anchors and filter by pathname heuristics
    const anchors = await page.$$eval('a[href]', els =>
      els.map(a => ({ href: (a as HTMLAnchorElement).href, text: (a as HTMLAnchorElement).innerText.trim() }))
    ).catch(() => [] as { href: string; text: string }[]);

    const seen = new Set<string>();
    const results: HackernoonItem[] = [];

    const isArticlePath = (pathname: string) => {
      const p = pathname.replace(/^\/+|\/+$/g, '');
      if (!p) return false;
      if (/^p\/[a-z0-9-]+$/i.test(p)) return true;
      if (/^[0-9]{4}\/[0-9]{1,2}\/[a-z0-9-]+$/i.test(p)) return true;
      if (/^[a-z0-9-]+$/i.test(p)) return true;
      if (/-[a-z0-9-]{4,}$/i.test(p)) return true;
      return false;
    };

    for (const a of anchors) {
      if (!a || !a.href) continue;
      try {
        const u = new URL(a.href, url);
        if (u.hostname !== 'hackernoon.com' && u.hostname !== 'www.hackernoon.com') continue;
        if (!isArticlePath(u.pathname)) continue;
        const href = u.toString();
        if (seen.has(href)) continue;
        seen.add(href);
        const title = a.text || href;
        results.push({ title: title.slice(0, 200), url: href });
        if (results.length >= limit) break;
      } catch {
        continue;
      }
    }

    logger.info(`Scraped ${results.length} hackernoon items from ${url}`);
    return results;
  } catch (err) {
    logger.error(`Error scraping hackernoon tag page ${url}: ${err}`);
    return [];
  } finally {
    await browser.close();
  }
}
