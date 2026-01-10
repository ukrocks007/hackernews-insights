import { chromium, Browser } from 'playwright';
import logger from './logger';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const TLDR_MODEL = 'qwen2.5:0.5b';
const PAGE_LOAD_TIMEOUT = 15000; // 15 seconds hard timeout
const MAX_CONTENT_WORDS = 4000; // ~3000-4000 words limit
const MIN_TEXT_CHUNK_LENGTH = 40;

export interface TLDRResult {
  tldr: string;
  model: string;
  contentLength: number;
  generatedAt: Date;
}

export interface ExtractedArticle {
  title: string;
  metaDescription: string;
  headings: string[];
  paragraphs: string[];
  codeBlocks: string[];
  fullText: string;
}

/**
 * Extract article content from a URL using Playwright.
 * This function is strict about removing non-article content.
 */
export async function extractArticleContent(url: string): Promise<ExtractedArticle | null> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ 
      headless: process.env.HEADLESS !== 'false',
      timeout: 30000
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (compatible; HNInsights-TLDR/1.0; +http://example.com)',
      viewport: { width: 1280, height: 720 }
    });
    
    // Block heavy resources for performance
    await context.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,otf,mp4,mp3,wav,flac,avi,mov,webm,css}', route => route.abort());

    const page = await context.newPage();
    
    // Navigate with hard timeout
    await page.goto(url, { 
      waitUntil: 'domcontentloaded', 
      timeout: PAGE_LOAD_TIMEOUT 
    });
    
    // Wait a bit for dynamic content
    await page.waitForTimeout(1000);
    
    // Extract title
    const title = await page.title();
    
    // Extract meta description
    const metaDescription = await page.$eval('meta[name="description"]', el => el.getAttribute('content'))
      .catch(() => page.$eval('meta[property="og:description"]', el => el.getAttribute('content')))
      .catch(() => '') || '';
    
    // Extract headings (h1, h2, h3)
    const headings = await page.$$eval('h1, h2, h3', els => 
      els.map(el => (el as HTMLElement).innerText.trim())
         .filter(t => t.length > 0 && t.length < 200)
         .slice(0, 20)
    );
    
    // Extract paragraphs from article content
    const paragraphs = await page.$$eval('article p, main p, .article p, .post-content p, .entry-content p', els => {
      return els.map(el => (el as HTMLElement).innerText.trim())
        .filter(t => t.length > 60)
        .slice(0, 50); // Limit number of paragraphs
    });
    
    // Extract code blocks if present
    const codeBlocks = await page.$$eval('pre code, pre, .highlight, .code-block', els => {
      return els.map(el => (el as HTMLElement).innerText.trim())
        .filter(t => t.length > 10 && t.length < 500)
        .slice(0, 5);
    });
    
    // Extract full article text (comprehensive)
    const fullText = await page.evaluate(
      ({ MIN_TEXT_CHUNK_LENGTH }) => {
        // Try to find article container
        const articleSelectors = [
          'article',
          'main',
          '[role="main"]',
          '.article',
          '.post',
          '.entry-content',
          '.post-content',
          '.article-content',
          '.content',
          '#content'
        ];
        
        let root = document.body;
        for (const selector of articleSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            root = element as HTMLElement;
            break;
          }
        }
        
        // Blacklist non-content elements
        const blacklist = new Set([
          'SCRIPT', 'STYLE', 'NAV', 'FOOTER', 'HEADER', 
          'NOSCRIPT', 'FORM', 'ASIDE', 'IFRAME', 'VIDEO',
          'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'
        ]);
        
        // Also remove by class/id patterns (ads, comments, related, etc.)
        const blacklistPatterns = [
          /comment/i, /reply/i, /discuss/i, 
          /advertisement/i, /ads?[-_]/i, /promo/i,
          /cookie/i, /gdpr/i, /consent/i,
          /newsletter/i, /subscribe/i, /signup/i,
          /social/i, /share/i, /follow/i,
          /related/i, /recommend/i, /popular/i,
          /sidebar/i, /widget/i, /footer/i, /header/i,
          /nav/i, /menu/i, /banner/i
        ];
        
        const shouldSkipElement = (el: Element): boolean => {
          if (blacklist.has(el.tagName)) return true;
          
          const className = el.className || '';
          const id = el.id || '';
          const combined = `${className} ${id}`.toLowerCase();
          
          for (const pattern of blacklistPatterns) {
            if (pattern.test(combined)) return true;
          }
          
          return false;
        };

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            const text = (node.textContent || '').trim();
            if (!text || text.length < MIN_TEXT_CHUNK_LENGTH) return NodeFilter.FILTER_SKIP;
            
            let parent = (node as Text).parentElement;
            while (parent) {
              if (shouldSkipElement(parent)) return NodeFilter.FILTER_SKIP;
              parent = parent.parentElement;
            }
            
            return NodeFilter.FILTER_ACCEPT;
          }
        });

        const chunks: string[] = [];
        while (walker.nextNode()) {
          const text = (walker.currentNode.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();
          if (text) {
            chunks.push(text);
          }
        }

        return chunks.join(' ');
      },
      { MIN_TEXT_CHUNK_LENGTH }
    );
    
    return {
      title: title.slice(0, 200),
      metaDescription: (metaDescription as string).slice(0, 300),
      headings,
      paragraphs,
      codeBlocks,
      fullText: fullText || ''
    };

  } catch (error) {
    logger.error(`Error extracting article content from ${url}: ${error}`);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Truncate text to approximately N words, breaking at sentence boundaries.
 */
function truncateToWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  
  // Take maxWords and try to find a sentence boundary
  const truncated = words.slice(0, maxWords).join(' ');
  const lastPeriod = truncated.lastIndexOf('.');
  const lastQuestion = truncated.lastIndexOf('?');
  const lastExclaim = truncated.lastIndexOf('!');
  const lastSentence = Math.max(lastPeriod, lastQuestion, lastExclaim);
  
  if (lastSentence > truncated.length * 0.7) {
    return truncated.slice(0, lastSentence + 1);
  }
  
  return truncated;
}

/**
 * Generate a TLDR summary using Ollama's qwen2.5:0.5b model.
 */
export async function generateTLDR(article: ExtractedArticle): Promise<TLDRResult | null> {
  try {
    // Build content for the LLM
    const contentParts: string[] = [];
    
    // Add title
    if (article.title) {
      contentParts.push(`Title: ${article.title}`);
    }
    
    // Add meta description
    if (article.metaDescription) {
      contentParts.push(`Description: ${article.metaDescription}`);
    }
    
    // Add headings
    if (article.headings.length > 0) {
      contentParts.push(`Key sections: ${article.headings.slice(0, 10).join('; ')}`);
    }
    
    // Add main content (truncated to word limit)
    const mainContent = article.fullText || article.paragraphs.join('\n\n');
    const truncatedContent = truncateToWords(mainContent, MAX_CONTENT_WORDS);
    contentParts.push(`Content: ${truncatedContent}`);
    
    // Add code blocks if present
    if (article.codeBlocks.length > 0) {
      contentParts.push(`Contains ${article.codeBlocks.length} code block(s)`);
    }
    
    const contentForLLM = contentParts.join('\n\n');
    const contentLength = contentForLLM.length;
    
    // System prompt (MUST MATCH EXACTLY as per requirements)
    const systemPrompt = `You generate concise TLDR summaries for technical articles.
Your goal is to help a developer decide whether to read the full article.

Rules:
- Use ONLY the provided content.
- Do NOT add external knowledge.
- Do NOT speculate.
- Do NOT persuade or hype.
- Be neutral and factual.
- Use bullet points.
- Maximum 6 bullet points.
- Do NOT include a conclusion paragraph.`;

    // User prompt template (MUST MATCH EXACTLY as per requirements)
    const userPrompt = `Article title:
${article.title}

Article content:
${truncatedContent}

Task:
Write a TLDR to help a technically literate reader decide
whether to read the full article.`;

    const payload = {
      model: TLDR_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      stream: false,
      options: {
        temperature: 0.3, // Low temperature for factual output
        num_predict: 300  // Limit output length
      }
    };
    
    logger.info(`Generating TLDR for article (content length: ${contentLength} chars)`);
    
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    const tldrText = data.message?.content?.trim() || '';
    
    if (!tldrText) {
      throw new Error('Empty response from Ollama');
    }
    
    logger.info(`TLDR generated successfully (${tldrText.length} chars)`);
    
    return {
      tldr: tldrText,
      model: TLDR_MODEL,
      contentLength,
      generatedAt: new Date()
    };
    
  } catch (error) {
    logger.error(`Error generating TLDR: ${error}`);
    return null;
  }
}

/**
 * Main entry point: extract article content and generate TLDR.
 */
export async function generateTLDRForURL(url: string): Promise<TLDRResult | null> {
  logger.info(`Starting TLDR generation for URL: ${url}`);
  
  // Extract article content
  const article = await extractArticleContent(url);
  if (!article) {
    logger.warn(`Failed to extract article content from ${url}`);
    return null;
  }
  
  // Generate TLDR
  const result = await generateTLDR(article);
  if (!result) {
    logger.warn(`Failed to generate TLDR for ${url}`);
    return null;
  }
  
  return result;
}
