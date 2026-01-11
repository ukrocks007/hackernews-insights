# TLDR Feature Documentation

## Overview

The TLDR feature provides user-initiated article summarization for stories in the HN Insights dashboard. When a user clicks the TLDR button on a story, the system:

1. Fetches the full article content using Playwright
2. Extracts and sanitizes the article text
3. Generates a concise technical summary using a local LLM (qwen2.5:0.5b via Ollama)
4. Caches the result in the database for instant future access

## Key Characteristics

- **User-Initiated Only**: Never runs automatically; only when explicitly requested
- **Latency**: 10-30 seconds for generation (acceptable on Raspberry Pi)
- **Quality Over Speed**: Optimized for output quality rather than generation speed
- **Cached Results**: Generated TLDRs are stored in the database
- **Raspberry Pi Optimized**: Uses lightweight qwen2.5:0.5b model

## Implementation Details

### Database Schema

New fields added to the `Story` model:
- `tldr` (nullable string): The generated summary text
- `tldrGeneratedAt` (nullable DateTime): When the TLDR was generated
- `tldrModel` (nullable string): Which model was used (e.g., "qwen2.5:0.5b")
- `tldrContentLength` (nullable int): Length of content sent to the LLM

### API Endpoint

**POST `/api/generate-tldr`**

Request body:
```json
{
  "storyId": "hackernews:12345"
}
```

Success response (cached):
```json
{
  "status": "ok",
  "tldr": "TLDR:\n- Point 1\n- Point 2\n...",
  "cached": true
}
```

Success response (new generation):
```json
{
  "status": "ok",
  "tldr": "TLDR:\n- Point 1\n- Point 2\n...",
  "cached": false,
  "model": "qwen2.5:0.5b",
  "contentLength": 15234
}
```

Error response:
```json
{
  "status": "error",
  "message": "TLDR unavailable for this article."
}
```

### Content Extraction

The system uses Playwright to extract article content with strict filtering:

**Extracted Elements:**
- Page title
- Meta description
- Headings (h1, h2, h3)
- Article paragraphs
- Code blocks (if present)
- Full article text

**Filtered Out:**
- Navigation menus
- Headers and footers
- Advertisements
- Cookie banners
- Comments sections
- Related articles
- Social sharing widgets
- Sidebars and widgets

**Limits:**
- Page load timeout: 15 seconds (hard limit)
- Content length: ~3,000-4,000 words
- Truncation: At sentence boundaries when possible

### LLM Integration

**Model:** qwen2.5:0.5b (lightweight, suitable for Raspberry Pi)

**System Prompt:**
```
You generate concise TLDR summaries for technical articles.
Your goal is to help a developer decide whether to read the full article.

Rules:
- Use ONLY the provided content.
- Do NOT add external knowledge.
- Do NOT speculate.
- Do NOT persuade or hype.
- Be neutral and factual.
- Use bullet points.
- Maximum 6 bullet points.
- Do NOT include a conclusion paragraph.
```

**User Prompt Template:**
```
Article title:
<extracted title>

Article content:
<sanitized extracted text>

Task:
Write a TLDR to help a technically literate reader decide
whether to read the full article.
```

**LLM Parameters:**
- Temperature: 0.3 (low for factual output)
- Max tokens: 300 (limit output length)

### UI Components

**TLDR Button:**
- Appears inline with story metadata
- Only shown for stories with URLs
- Icon: 📄 TLDR
- Styled as a subtle action button

**TLDR Modal:**
- Full-screen overlay with backdrop blur
- Loading state with spinner
- Formatted display of bullet points
- Metadata footer showing model and cache status
- Close button (× in header or click outside)

## Testing Instructions

### Prerequisites

1. **Install Ollama:**
   ```bash
   curl -fsSL https://ollama.ai/install.sh | sh
   ```

2. **Pull the qwen2.5:0.5b model:**
   ```bash
   ollama pull qwen2.5:0.5b
   ```

3. **Ensure Ollama is running:**
   ```bash
   # Should be running as a service, or start manually:
   ollama serve
   ```

4. **Install Playwright browsers:**
   ```bash
   npx playwright install chromium
   ```

### Manual Testing Steps

1. **Start the application:**
   ```bash
   npm run dev
   # or for production build:
   npm run build && npm start
   ```

2. **Open the dashboard:**
   ```
   http://localhost:3000
   ```

3. **Trigger a fetch to get some stories:**
   - Click the "🔄 Trigger Fetch" button
   - Wait for stories to appear

4. **Test TLDR generation:**
   - Find a story with a URL (most should have one)
   - Click the "📄 TLDR" button
   - Observe:
     - Modal opens with loading spinner
     - After 10-30 seconds, TLDR appears
     - Modal shows bullet points and metadata
     - Close modal (click × or outside)

5. **Test TLDR caching:**
   - Click the same TLDR button again
   - Should load instantly from cache
   - Modal shows "✓ Cached result"

6. **Test error handling:**
   - Try TLDR on a story with no URL (should show error)
   - Try with Ollama stopped (should fail gracefully)

### Verification Checklist

- [ ] TLDR button appears on stories with URLs
- [ ] TLDR button does not appear on stories without URLs
- [ ] Clicking TLDR opens modal with loading state
- [ ] TLDR generates successfully (10-30 seconds)
- [ ] TLDR displays as formatted bullet points
- [ ] Modal shows model information
- [ ] Cached TLDRs load instantly
- [ ] Modal shows cache status
- [ ] Modal can be closed (× button or click outside)
- [ ] Error cases display appropriate messages
- [ ] Database stores TLDR data correctly
- [ ] Multiple TLDRs can be generated without issues

### Database Verification

Check that TLDRs are stored correctly:

```bash
sqlite3 db/hn.sqlite "SELECT id, title, tldr IS NOT NULL as has_tldr, tldrModel, tldrGeneratedAt FROM stories WHERE tldr IS NOT NULL LIMIT 5;"
```

## Constraints and Non-Goals

### What TLDR Does NOT Do

- ❌ No automatic generation (only on user request)
- ❌ No comments summarization
- ❌ No relevance inference
- ❌ No ranking or scoring
- ❌ No background jobs
- ❌ No embeddings or semantic search
- ❌ No external browsing beyond article URL
- ❌ No multi-article comparison
- ❌ No persistent background workers

### Design Decisions

1. **User-Initiated Only**: Respects user intent and conserves resources
2. **Caching**: Avoids redundant LLM calls and improves UX
3. **Lightweight Model**: qwen2.5:0.5b chosen for Raspberry Pi compatibility
4. **Hard Timeouts**: Ensures responsive experience even if extraction fails
5. **Content Filtering**: Aggressive removal of non-article content for quality
6. **Bullet Point Format**: Easy to scan, decision-focused output

## Troubleshooting

### TLDR Generation Fails

**Problem:** Modal shows "TLDR unavailable for this article."

**Possible causes:**
1. Ollama not running or model not available
2. Article URL is inaccessible
3. Page load timeout (>15s)
4. Content extraction failed (PDF, image, etc.)

**Solutions:**
1. Check Ollama: `ollama list` should show qwen2.5:0.5b
2. Verify URL is accessible in browser
3. Check application logs for errors
4. Ensure Playwright browsers are installed

### TLDR Takes Too Long

**Problem:** Generation takes longer than 30 seconds

**Possible causes:**
1. Large article with lots of content
2. Slow network connection
3. Resource constraints on Raspberry Pi
4. Ollama model loading

**Solutions:**
1. This is acceptable per requirements (10-30s expected)
2. Ensure good network connection
3. Monitor system resources (CPU, RAM)
4. Consider upgrading hardware if consistently slow

### TLDR Content Quality Issues

**Problem:** Generated summary is not useful or accurate

**Possible causes:**
1. Poor content extraction (too much noise)
2. Article structure not recognized
3. Model limitations

**Solutions:**
1. Check extracted content in logs
2. Adjust content extraction selectors if needed
3. Consider temperature adjustment (currently 0.3)
4. May need to tune prompts for specific content types

## Architecture Notes

### Why This Design?

1. **Separation of Concerns**: TLDR generation is independent of ingestion/relevance
2. **Explicit User Control**: User decides when to spend resources on TLDR
3. **Caching Layer**: Database caching prevents redundant work
4. **Graceful Degradation**: Failures don't break core functionality
5. **Resource Conscious**: Lightweight model and lazy evaluation

### Future Improvements (Out of Scope)

- Support for multiple TLDR models
- User preference for TLDR length
- TLDR quality feedback mechanism
- Batch TLDR generation
- TLDR comparison across sources
- Multi-language support

## Files Modified/Added

### New Files
- `src/tldrGenerator.ts` - Core TLDR generation logic

### Modified Files
- `prisma/schema.prisma` - Added TLDR fields to Story model
- `src/storage.ts` - Added saveTLDR() and getTLDR() functions
- `src/feedbackServer.ts` - Added POST /api/generate-tldr endpoint
- `src/dashboard.ts` - Added TLDR button, modal, and JavaScript handlers
- `AI_CONTEXT.md` - Comprehensive TLDR feature documentation

### Configuration
- Model: qwen2.5:0.5b (configured in tldrGenerator.ts)
- Ollama URL: Uses OLLAMA_BASE_URL env var (defaults to http://localhost:11434)
- Headless mode: Uses HEADLESS env var (defaults to true)

## Summary

The TLDR feature provides a user-friendly way for readers to quickly understand article content before committing to reading. It respects resource constraints, provides fast cached access, and maintains high-quality output through careful prompt engineering and content extraction.
