import { chromium, Browser, Page } from 'playwright';
import logger from './logger';
import { ContentSignals } from './contentScraper';
import { NormalizedStoryCandidate, deriveStoryIdFromUrl } from './sourceRegistry';

interface Snapshot {
  url: string;
  title: string;
  headings: string[];
  snippets: string[];
  links: Array<{ id: string; text: string; href: string }>;
}

interface BrowsingDecision {
  action: 'click' | 'extract' | 'stop';
  target: string | null;
  reason: string;
}

interface FallbackBrowsingOptions {
  sourceId: string;
  seedUrl: string;
  domainAllowlist: string[];
  maxPages?: number;
  maxClicks?: number;
  maxDepth?: number;
  timeoutMs?: number;
  maxCandidates?: number;
}

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const BROWSING_MODEL = process.env.BROWSING_MODEL || 'qwen:0.5b';
const BLOCKED_RESOURCE_GLOB = '**/*.{png,jpg,jpeg,gif,webp,svg,css,woff,woff2,mp4,mp3}';
const DEFAULT_FALLBACK_USER_AGENT =
  'Mozilla/5.0 (compatible; HackerNewsInsights/1.0; +https://github.com/ukrocks007/hackernews-insights)';

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

async function extractHeadings(page: Page, max: number = 5): Promise<string[]> {
  return page
    .$$eval('h1, h2', els =>
      els
        .map(el => (el as HTMLElement).innerText.trim())
        .filter(Boolean)
        .slice(0, max)
    )
    .catch(() => []);
}

function isDomainAllowed(url: string, allowlist: string[]): boolean {
  try {
    const hostname = new URL(url).hostname;
    if (allowlist.length === 0) return false;
    return allowlist.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

async function captureSnapshot(page: Page, url: string): Promise<Snapshot> {
  const title = (await page.title()) || '';

  const headings = await extractHeadings(page);

  const snippets = await page
    .$$eval('p', els =>
      els
        .map(el => (el as HTMLElement).innerText.trim())
        .filter(t => t.length > 40)
        .slice(0, 4)
    )
    .catch(() => []);

  const links = await page
    .$$eval('a', els =>
      els
        .map((el, index) => {
          const href = (el as HTMLAnchorElement).href || '';
          const text = (el as HTMLElement).innerText.trim();
          return { id: `link-${index}`, text: text.slice(0, 140), href };
        })
        .filter(link => !!link.href)
        .slice(0, 20)
    )
    .catch(() => []);

  return { url, title, headings, snippets, links };
}

async function extractContentFromPage(page: Page): Promise<ContentSignals> {
  const pageTitle = await page.title();

  const description =
    (await page
      .$eval('meta[name="description"]', el => el.getAttribute('content'))
      .catch(() => page.$eval('meta[property="og:description"]', el => el.getAttribute('content')))
      .catch(() => '')) || '';

  const headings = await extractHeadings(page);

  const paragraphs = await page
    .$$eval('p', els =>
      els
        .map(el => (el as HTMLElement).innerText.trim())
        .filter(t => t.length > 60)
        .slice(0, 3)
    )
    .catch(() => []);

  const hasCodeBlocks = (await page.$('pre code, .highlight, .code')) !== null;

  return {
    pageTitle: pageTitle.slice(0, 100),
    description: (description as string).slice(0, 200),
    headings: headings.map(h => h.slice(0, 100)),
    paragraphs: paragraphs.map(p => p.slice(0, 300)),
    hasCodeBlocks,
    bodyText: paragraphs.join(' ').slice(0, 8000),
  };
}

function sanitizeDecision(raw: any): BrowsingDecision {
  const allowedActions: Array<BrowsingDecision['action']> = ['click', 'extract', 'stop'];
  if (!raw || typeof raw !== 'object') {
    return { action: 'stop', target: null, reason: 'Invalid response shape' };
  }
  const action = allowedActions.includes(raw.action) ? raw.action : 'stop';
  const target = typeof raw.target === 'string' || raw.target === null ? raw.target : null;
  const reason = typeof raw.reason === 'string' ? raw.reason : 'No reason provided';
  return { action, target, reason };
}

async function getBrowsingDecision(snapshot: Snapshot): Promise<BrowsingDecision> {
  const prompt = `You are controlling a constrained browser with strict safety limits.
Review the snapshot and decide a single next action.
Return ONLY a JSON object with keys "action", "target", and "reason".
Actions allowed:
- "extract": current page is the article, stay here.
- "click": follow one of the provided link ids.
- "stop": stop browsing.
Never propose multiple steps, never include prose outside JSON.`;

  const payload = {
    model: BROWSING_MODEL,
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: JSON.stringify({
          url: snapshot.url,
          title: snapshot.title,
          headings: snapshot.headings,
          snippets: snapshot.snippets,
          links: snapshot.links,
        }),
      },
    ],
    stream: false,
  };

  const controller = new AbortController();
  const decisionTimeout = parsePositiveNumber(process.env.FALLBACK_DECISION_TIMEOUT_MS, 15000);
  const timer = setTimeout(() => controller.abort(), decisionTimeout);

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const content = typeof data?.message?.content === 'string' ? data.message.content.trim() : '';
    try {
      const parsed = JSON.parse(content);
      return sanitizeDecision(parsed);
    } catch {
      return {
        action: 'stop',
        target: null,
        reason: `Non-JSON decision returned: ${content ? content.slice(0, 120) : 'empty response'}`,
      };
    }
  } catch (error) {
    logger.error(`[fallback] Failed to get browsing decision: ${error}`);
    return { action: 'stop', target: null, reason: 'Decision service failed' };
  } finally {
    clearTimeout(timer);
  }
}

export async function browseWithLLMFallback(options: FallbackBrowsingOptions): Promise<NormalizedStoryCandidate[]> {
  const {
    sourceId,
    seedUrl,
    domainAllowlist,
    maxPages = parsePositiveNumber(process.env.FALLBACK_MAX_PAGES, 3),
    maxClicks = parsePositiveNumber(process.env.FALLBACK_MAX_CLICKS, 2),
    maxDepth = parsePositiveNumber(process.env.FALLBACK_MAX_DEPTH, 2),
    timeoutMs = parsePositiveNumber(process.env.FALLBACK_TIMEOUT_MS, 120000),
    maxCandidates = parsePositiveNumber(process.env.FALLBACK_MAX_CANDIDATES, 2),
  } = options;
  const navigationTimeout = parsePositiveNumber(process.env.FALLBACK_NAV_TIMEOUT_MS, 20000);
  const fallbackUserAgent = process.env.FALLBACK_USER_AGENT || DEFAULT_FALLBACK_USER_AGENT;

  let browser: Browser | null = null;
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: seedUrl, depth: 0 }];
  const startTime = Date.now();
  const candidates: NormalizedStoryCandidate[] = [];
  let clicks = 0;
  let pagesVisited = 0;

  let allowlist = domainAllowlist;
  if (allowlist.length === 0) {
    try {
      allowlist = [new URL(seedUrl).hostname];
    } catch {
      allowlist = [];
    }
  }
  if (allowlist.length === 0) {
    logger.warn(`[fallback][${sourceId}] No valid domain allowlist available. Aborting fallback browsing.`);
    return [];
  }

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: fallbackUserAgent,
      viewport: { width: 1280, height: 720 },
    });
    await context.route(BLOCKED_RESOURCE_GLOB, route => route.abort());

    while (queue.length > 0) {
      if (Date.now() - startTime > timeoutMs) {
        logger.warn(`[fallback][${sourceId}] Global timeout ${timeoutMs}ms reached. Stopping.`);
        break;
      }

      if (pagesVisited >= maxPages) {
        logger.warn(`[fallback][${sourceId}] Max pages (${maxPages}) reached. Stopping.`);
        break;
      }

      const next = queue.shift();
      if (!next) break;
      const { url, depth } = next;

      if (visited.has(url)) {
        logger.info(`[fallback][${sourceId}] Duplicate URL detected (${url}); skipping.`);
        continue;
      }

      if (!isDomainAllowed(url, allowlist)) {
        logger.warn(`[fallback][${sourceId}] Skipping ${url} (outside allowlist).`);
        continue;
      }

      visited.add(url);
      pagesVisited++;

      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navigationTimeout });
        const snapshot = await captureSnapshot(page, url);
        const decision = await getBrowsingDecision(snapshot);
        logger.info(
          `[fallback][${sourceId}] decision=${decision.action} target=${decision.target ?? 'none'} reason=${decision.reason}`
        );

        if (decision.action === 'extract') {
          const content = await extractContentFromPage(page);
          candidates.push({
            id: deriveStoryIdFromUrl(url),
            title: snapshot.title || 'Untitled',
            url,
            sourceId,
            content,
          });
          if (candidates.length >= maxCandidates) {
            logger.info(`[fallback][${sourceId}] Reached max candidates (${maxCandidates}). Stopping.`);
            break;
          }
        } else if (decision.action === 'click') {
          if (clicks >= maxClicks) {
            logger.warn(`[fallback][${sourceId}] Max clicks (${maxClicks}) hit. Stopping.`);
            break;
          }
          const targetLink = snapshot.links.find(link => link.id === decision.target);
          if (!targetLink) {
            logger.warn(`[fallback][${sourceId}] Invalid click target "${decision.target}".`);
          } else if (!isDomainAllowed(targetLink.href, allowlist)) {
            logger.warn(`[fallback][${sourceId}] Blocked navigation to ${targetLink.href} (not in allowlist).`);
          } else if (visited.has(targetLink.href)) {
            logger.warn(`[fallback][${sourceId}] Duplicate URL detected (${targetLink.href}); skipping click.`);
          } else if (depth + 1 > maxDepth) {
            logger.warn(`[fallback][${sourceId}] Max depth (${maxDepth}) would be exceeded. Stopping navigation.`);
          } else {
            queue.push({ url: targetLink.href, depth: depth + 1 });
            clicks++;
          }
        } else {
          logger.info(`[fallback][${sourceId}] Stopping per model instruction.`);
          break;
        }
      } catch (error) {
        logger.warn(`[fallback][${sourceId}] Failed to browse ${url}: ${error}`);
      } finally {
        await page.close();
      }
    }
  } catch (error) {
    logger.error(`[fallback][${sourceId}] Browser failure: ${error}`);
  } finally {
    if (browser) await browser.close();
  }

  return candidates;
}
