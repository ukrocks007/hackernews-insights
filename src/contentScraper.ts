import { chromium, Browser } from 'playwright';
import logger from './logger';

export interface ContentSignals {
  pageTitle: string;
  description: string;
  headings: string[];
  paragraphs: string[];
  hasCodeBlocks: boolean;
  bodyText: string;
}

const MIN_TEXT_CHUNK_LENGTH = 40;
const MIN_TRUNCATION_POSITION = 2000;
// Allow a small buffer beyond MAX_CHARS before hard truncation to avoid mid-sentence cuts.
const CONTENT_EXTRACTION_BUFFER_RATIO = 1.2;

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

    const bodyText = await page.evaluate(
      ({ MIN_TEXT_CHUNK_LENGTH, MIN_TRUNCATION_POSITION, CONTENT_EXTRACTION_BUFFER_RATIO }) => {
        const MAX_CHARS = 8000;
        const preferred = document.querySelector('article') || document.querySelector('main');
        const root = preferred || document.body;
        const blacklist = new Set(['SCRIPT', 'STYLE', 'NAV', 'FOOTER', 'HEADER', 'NOSCRIPT', 'FORM', 'ASIDE']);

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const text = (node.textContent || '').trim();
          if (!text || text.length < MIN_TEXT_CHUNK_LENGTH) return NodeFilter.FILTER_SKIP;
          const parent = (node as Text).parentElement;
          if (parent && blacklist.has(parent.tagName)) return NodeFilter.FILTER_SKIP;
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      const chunks: string[] = [];
      let approxLength = 0;
      while (walker.nextNode()) {
        const text = (walker.currentNode.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) {
          chunks.push(text);
          approxLength += text.length + 1;
        }
        if (approxLength > MAX_CHARS * CONTENT_EXTRACTION_BUFFER_RATIO) break; // soft stop to avoid extra work
      }

      const joined = chunks.join(' ');
      if (joined.length <= MAX_CHARS) return joined;
      const truncated = joined.slice(0, MAX_CHARS);
      const lastSpace = truncated.lastIndexOf(' ');
      const safeCut = lastSpace > MIN_TRUNCATION_POSITION ? lastSpace : MAX_CHARS;
      return truncated.slice(0, Math.max(safeCut, 0));
      },
      { MIN_TEXT_CHUNK_LENGTH, MIN_TRUNCATION_POSITION, CONTENT_EXTRACTION_BUFFER_RATIO }
    );

    const hasCodeBlocks = await page.$('pre code, .highlight, .code') !== null;

    return {
      pageTitle: pageTitle.slice(0, 100),
      description: (description as string).slice(0, 200),
      headings: headings.map(h => h.slice(0, 100)),
      paragraphs: paragraphs.map(p => p.slice(0, 300)),
      hasCodeBlocks,
      bodyText: (bodyText || '').slice(0, 8000)
    };

  } catch (error) {
    logger.error(`Error scraping content for ${url}: ${error}`);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}
