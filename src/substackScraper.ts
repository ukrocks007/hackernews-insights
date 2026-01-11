import { chromium } from "playwright";
import logger from "./logger";

export interface SubstackItem {
  title: string;
  url: string;
  date?: string | null;
  excerpt?: string | null;
}

/**
 * Scrapes a Substack author's archive page for recent posts.
 * @param username - The Substack username (e.g., "addyo" for addyo.substack.com)
 * @param limit - Maximum number of posts to scrape
 * @returns Array of SubstackItem with title, url, date, and excerpt
 */

/**
 * Scrapes a Substack author's archive page for recent posts.
 * @param usernameOrUrl - The Substack username (e.g., "addyo") or full archive URL (e.g., "https://addyo.substack.com/archive?sort=new")
 * @param limit - Maximum number of posts to scrape
 * @returns Array of SubstackItem with title, url, date, and excerpt
 */
export async function scrapeSubstackArchive(
  usernameOrUrl: string,
  limit: number = 30,
): Promise<SubstackItem[]> {
  let archiveUrl: string;
  if (/^https?:\/\//.test(usernameOrUrl)) {
    archiveUrl = usernameOrUrl;
  } else {
    archiveUrl = `https://${usernameOrUrl}.substack.com/archive?sort=new`;
  }
  logger.info(
    `[Substack:${usernameOrUrl}] Starting scrape from ${archiveUrl} (limit=${limit})`,
  );

  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== "false",
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
  });

  // Block heavy assets for faster scraping
  await context.route(
    "**/*.{png,jpg,jpeg,gif,webp,svg,mp4,mp3,woff,woff2,ttf}",
    (route) => route.abort(),
  );

  const page = await context.newPage();
  page.setDefaultNavigationTimeout(30000);
  page.setDefaultTimeout(15000);

  try {
    await page.goto(archiveUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Wait a bit for dynamic content to load
    await page.waitForTimeout(2000);

    // Substack archive pages typically use a consistent structure
    // Posts are usually in divs/articles with links to individual posts
    const items = await page
      .$$eval(
        'a[href*="/p/"]',
        (links, max) => {
          const results: Array<{
            title: string;
            url: string;
            date?: string | null;
            excerpt?: string | null;
          }> = [];
          const seen = new Set<string>();

          for (const link of links) {
            const href = (link as HTMLAnchorElement).href;
            if (!href || seen.has(href)) continue;

            // Only include posts from the /p/ path (actual articles)
            if (!href.includes("/p/")) continue;

            seen.add(href);

            // Try to find title - could be in the link itself or nearby
            const titleText = link.textContent?.trim() || "";
            if (!titleText || titleText.length < 3) continue;

            // Look for date in nearby elements
            const parent = link.closest("div, article, li");
            let date: string | null = null;
            if (parent) {
              const timeEl = parent.querySelector("time");
              date =
                timeEl?.getAttribute("datetime") ||
                timeEl?.textContent?.trim() ||
                null;
            }

            // Look for excerpt/subtitle in nearby elements
            let excerpt: string | null = null;
            if (parent) {
              // Substack often has a subtitle or description near the title
              const subtitleEl = parent.querySelector(
                ".subtitle, .description, p",
              );
              if (subtitleEl && subtitleEl !== link) {
                excerpt = subtitleEl.textContent?.trim() || null;
              }
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
        limit,
      )
      .catch(() => [] as SubstackItem[]);

    logger.info(`[Substack:${usernameOrUrl}] Scraped ${items.length} posts`);
    return items;
  } catch (err) {
    logger.error(`Error scraping Substack archive for ${usernameOrUrl}: ${err}`);
    return [];
  } finally {
    await browser.close();
  }
}
