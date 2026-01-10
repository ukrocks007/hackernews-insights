# AI Assistant — Project Context & Coding Guidelines

This file is intended to be read by the assistant at the start of each session to provide core context and instructions for working on this repository.

---

## Project Overview
- Name: `hackernews-insights`
- Purpose: Continuously discover, filter, and notify on highly relevant engineering/AI/startup stories using:
  - deterministic scraping (Hacker News + Hackernoon tags),
  - an Ollama-hosted LLM for relevance gating and browsing decisions,
  - a topic graph stored in SQLite via Prisma,
  - Pushover notifications with a signed feedback loop and a small web dashboard.
- Core runtime behavior:
  - `src/index.ts` is the entrypoint; it initializes the database and starts the feedback/dashboard HTTP server.
  - Ingestion is **not** run automatically; `/api/trigger-fetch` (or the dashboard "Trigger Fetch" button) calls `fetchAndFilterStories()` from `src/insightTracker.ts`.
  - Storage and persistence use Prisma + SQLite (`prisma/schema.prisma`, `src/prismaClient.ts`, `src/storage.ts`).

## High-level Architecture
- **Multi-source ingestion (code-first registry):**
  - `src/sourceRegistry.ts` defines all sources via `SourceCapability`:
    - Hacker News (structured scraping via Playwright)
    - Hackernoon tag pages (structured scraping via Playwright)
    - GitHub Blog (structured scraping via Playwright)
    - Substack (generic, config-driven for multiple authors via Playwright)
    - Addy Osmani Blog (structured scraping via Playwright)
    - Optional LLM-guided fallback browsing over arbitrary seed URLs.
  - Each source either has a `structuredIngestor` or is browsed via the LLM-driven fallback browser.
- **Scraping & content signals:**
  - `src/hnScraper.ts`, `src/hackernoonScraper.ts` scrape candidate stories.
  - `src/contentScraper.ts` turns article pages into structured `ContentSignals` (titles, headings, paragraphs, body text, code-block presence).
- **LLM relevance & browsing:**
  - `src/relevanceAgent.ts` calls Ollama chat (`/api/chat`) with a tool-call style interface (`save_story`) to decide if a story is relevant and why.
  - `src/fallbackBrowser.ts` uses Playwright plus a small LLM model to drive constrained crawling within an allowlisted domain and surface candidate stories.
- **Storage, topics, and scoring:**
  - `src/storage.ts` wraps Prisma for stories, relevance scores, topic associations, and suppression state.
  - `src/topicExtractor.ts` implements deterministic topic extraction from title/url/content; `Topic` and `StoryTopic` are modeled in Prisma.
- **Notifications & feedback:**
  - `src/notifier.ts` sends Pushover notifications for top stories and can include signed feedback links.
  - `src/feedback.ts` signs/validates feedback links (HMAC), persists feedback events, recomputes relevance, and updates topic scores.
  - `src/feedbackServer.ts` + `src/dashboard.ts` expose `/`, `/api/feedback`, `/api/trigger-fetch`, `/api/stories`, `/api/submit-feedback`, `/api/submit-rating`.

## Dashboard UI & Review Workflow

### Review State & Decision-Making
The dashboard is designed as a **decision-making interface**, not a content browser. Its primary purpose is to surface items requiring human judgment and enable rapid review cycles.

- **Rating states:**
  - `null` (unrated) — Items awaiting review
  - `"useful"` — Valuable content worth keeping
  - `"skip"` — Not currently relevant
  - `"bookmark"` — High-priority or reference material
- **Default view:** Prioritizes **unrated** items (items with `rating = null`). Unrated items are visually emphasized with a yellow highlight to draw attention.
- **Rated items:** Visually recede with reduced opacity, allowing users to focus on pending decisions.

### Filtering Philosophy
The UI provides **composable, fast filters** to help users focus their attention:

1. **Review Status Filter:**
   - Default: Show only unrated items
   - Options: All, Unrated, Useful, Skip, Bookmark
   - Purpose: Focus on items needing review or revisit past decisions

2. **Source Filter:**
   - Multi-select filter using compact chip/pill UI
   - Sources derived from story IDs (e.g., `hackernews`, `github_blog`, `substack:username`)
   - Purpose: Filter by content origin (HN, blogs, newsletters, etc.)
   - No "All sources" button needed—empty selection = all sources

3. **Topic Filter:**
   - Multi-select filter using compact chip/pill UI
   - Shows top 20 topics by cumulative score
   - Purpose: Filter by content subject matter (e.g., "TypeScript", "React", "AI")
   - Topics are precomputed via `topicExtractor.ts` and stored in the database

4. **Notification Status & Sorting:**
   - Filter by whether a story has been sent via notification
   - Sort by: First Seen (default), HN Score, Relevance Score, or Date
   - Sort order: Ascending or Descending

### Metadata Presentation
Metadata is displayed inline within the list to aid decision-making without requiring additional clicks:

- **Source tag:** Compact colored badge showing content origin (e.g., `HACKERNEWS`, `GITHUB_BLOG`)
- **Topics:** Display up to 3 topics inline, with `+N` indicator if more exist
- **Match reason:** Shows the LLM's rationale for why the story was surfaced (truncated to ~80 chars)
- **HN Score:** Displayed when available (from Hacker News stories)
- **Rating badge:** Visual indicator of review state (UNRATED, useful, skip, bookmark)

### Why Scoring is NOT Shown Prominently
- **Relevance scores** are internal signals used for ranking and suppression.
- The UI does **not** display raw scores or confidence values to users in the main list.
- Users make decisions based on **title, source, topics, and match reason**, not numerical scores.
- This prevents users from over-relying on algorithmic judgments and ensures human agency in review.

### Metadata Precomputation & No Live Inference
- **All metadata is precomputed** during ingestion:
  - Topics are extracted via deterministic heuristics in `topicExtractor.ts`
  - Match reasons come from the LLM during relevance checking (`relevanceAgent.ts`)
  - Source information is derived from story IDs
- **The UI does NOT:**
  - Perform live LLM calls
  - Run embeddings or similarity searches
  - Execute real-time topic extraction
- This ensures the dashboard remains fast and predictable, with all data available instantly from the database.

## Important Files & Responsibilities

### Core runtime
- `src/index.ts`
  - Entrypoint (`npm run dev` and `npm start` resolve here via TS/compiled JS).
  - Initializes the database via `initDB()` from `src/storage.ts`.
  - Starts `startFeedbackServer()` and logs failures as warnings, but keeps the agent running.
  - **Critical:** The app must stay alive after starting the server - there should be NO `finally` block that closes the database or exits.
  - **Graceful shutdown:** Handles SIGINT and SIGTERM signals to close database connections properly before exit.
  - Exports `fetchAndFilterStories` for the trigger endpoint.

- `src/insightTracker.ts`
  - Orchestrates the **ingestion pipeline** across sources from `getSourceRegistry()`.
  - For each `NormalizedStoryCandidate`:
    - Skips already-processed stories via `hasStoryBeenProcessed`.
    - Applies a Hacker News score pre-filter (`MIN_HN_SCORE`) for HN candidates only.
    - Fetches `ContentSignals` via `scrapeStoryContent` or uses pre-attached content.
    - Calls `checkRelevance` (Ollama) and, on match, persists a `Story` via `saveStory` with an initial relevance score.
  - After ingestion, calls `getUnsentRelevantStories()`, ranks by relevance/score, and sends up to 5 notifications via `sendStoryNotification`, marking them as sent.

### Scrapers & multi-source registry
- `src/sourceRegistry.ts`
  - Declares `SourceCapability`, `StructuredIngestor`, and `NormalizedStoryCandidate`.
  - `getSourceRegistry()` returns the ordered list of sources:
    - `github_blog` — structured ingest via `ingestGithubBlogStructured`.
    - `addy_osmani_blog` — structured ingest via `ingestAddyOsmaniBlogStructured`.
    - `substack:{username}` — generic structured ingest via `createSubstackIngestor(username)` for each configured username.
    - `hackernoon` — structured ingest via `ingestHackernoonStructured`, with optional LLM fallback.
    - `hackernews` — structured ingest via `ingestHackerNewsStructured`.
    - `fallback-browse` — generic LLM-driven browsing if configured.
  - Reads environment:
    - `FALLBACK_SEED_URLS`, `FALLBACK_DOMAIN_ALLOWLIST` (CSV)
    - `HACKERNOON_SEED_URLS`, `HACKERNOON_DOMAIN_ALLOWLIST`, `HACKERNOON_TAG_URL`.
    - `GITHUB_BLOG_DOMAIN_ALLOWLIST`, `ENABLE_GITHUB_BLOG` (default true).
    - `SUBSTACK_USERNAMES` (CSV) — configures multiple Substack sources.
    - `ENABLE_ADDY_OSMANI_BLOG` (default true).
  - `deriveStoryIdFromUrl()` produces deterministic IDs for non-HN sources.
  - `createSubstackIngestor(username)` — factory function that creates a generic Substack ingestor for any username.

- `src/hnScraper.ts`
  - Uses Playwright to scrape Hacker News front pages, extracting ID, title, URL, HN score, and rank.
  - Honors `HEADLESS` for browser mode.

- `src/hackernoonScraper.ts`
  - Uses Playwright to scrape Hackernoon tag pages, heuristically selecting article-like paths.
  - Honors `HEADLESS` and returns a list of `{ title, url }` items.

- `src/githubBlogScraper.ts`
  - Uses Playwright to scrape github.blog homepage, extracting title, URL, date, and excerpt from article elements.
  - Honors `HEADLESS` and blocks heavy assets for performance.

- `src/substackScraper.ts`
  - Generic Substack archive scraper accepting a username parameter.
  - Scrapes `https://{username}.substack.com/archive?sort=new` for recent posts.
  - Extracts title, URL, date, and excerpt from post links and nearby elements.
  - Returns `SubstackItem[]` interface.
  - Honors `HEADLESS` and blocks heavy assets for performance.

- `src/addyOsmaniBlogScraper.ts`
  - Scrapes addyosmani.com/blog for recent blog posts.
  - Extracts title, URL, date, and excerpt from article/list elements.
  - Returns `AddyOsmaniBlogItem[]` interface.
  - Honors `HEADLESS` and blocks heavy assets for performance.

- `src/contentScraper.ts`
  - Uses Playwright to visit a story URL and extract `ContentSignals`:
    - HTML title, meta description, top headings, representative paragraphs, `hasCodeBlocks`, and normalized body text.
  - Skips clearly non-HTML URLs (e.g. PDFs, images, video) early.
  - Aggressively blocks heavy assets for speed; honors `HEADLESS`.

### LLM integration & fallback browsing
- `src/relevanceAgent.ts`
  - Loads `OLLAMA_BASE_URL` and `OLLAMA_MODEL` (defaults to `http://localhost:11434` and `functiongemma`).
  - Reads user interests from `config/interests.json` (either beside the compiled binary or in `config/` during development).
  - Builds a compact prompt from `ContentSignals` and sends an Ollama chat request with a **`save_story` tool**; the model must either:
    - call `save_story({ reason })` → treated as a strong match, or
    - respond with `IGNORE` → treated as not relevant.

- `src/fallbackBrowser.ts`
  - Implements LLM-guided browsing using Playwright + an Ollama model (`BROWSING_MODEL`, default `qwen:0.5b`).
  - Workflow per seed URL:
    - Visit a page, build a `Snapshot` (URL, title, headings, snippets, candidate links).
    - Ask the LLM for a single JSON decision: `action` (`click` | `extract` | `stop`), `target` link id, `reason`.
    - On `extract`, scrape `ContentSignals` and register a `NormalizedStoryCandidate` using `deriveStoryIdFromUrl`.
    - On `click`, enqueue another URL if it stays within `domainAllowlist`, click/visit/depth limits.
  - Controlled via environment:
    - `FALLBACK_DECISION_TIMEOUT_MS`, `FALLBACK_TIMEOUT_MS`, `FALLBACK_NAV_TIMEOUT_MS`
    - `FALLBACK_MAX_PAGES`, `FALLBACK_MAX_CLICKS`, `FALLBACK_MAX_DEPTH`, `FALLBACK_MAX_CANDIDATES`
    - `FALLBACK_USER_AGENT`, `HEADLESS`.

### Storage & database access
- `prisma/schema.prisma`
  - `Story` (table `stories`):
    - `id` (string, HN id or deterministic hash), `title`, optional `url`, `score`, `rank`, `date` (YYYY-MM-DD string), `reason`.
    - `relevanceScore` (scaled integer), `rating` (string, nullable: `"useful" | "skip" | "bookmark" | null`), `notificationSent`, `firstSeenAt`, `lastNotifiedAt`, `suppressedUntil`.
    - Relations: `feedbackEvents`, `storyTopics`.
    - **New `rating` field:** Tracks human review state. `null` means unrated/pending review. Used by the dashboard to prioritize unreviewed items and filter by review status.
  - `FeedbackEvent` (table `feedback_events`): links feedback to a story with `action`, `confidence`, `source`, `createdAt`, optional `metadata` JSON-as-string.
  - `Topic` (table `topics`): topic name, cumulative `score`, timestamps, and `storyRefs` relation.
  - `StoryTopic` (table `story_topics`): join model `{ storyId, topicId }` with `source` and `weight`.

- `src/prismaClient.ts`
  - Lazily creates a singleton `PrismaClient`.
  - `DATABASE_URL` resolution:
    - Uses explicit `DATABASE_URL` if set.
    - Otherwise, sets it to `file:db/hn.sqlite` under the project/bundled directory and creates the `db/` folder if needed.

- `src/storage.ts`
  - DB lifecycle helpers: `initDB()`, `closeDB()` (wrap Prisma connect/disconnect).
  - Story helpers:
    - `saveStory(story: StoryInput, topics?: TopicInput[])` — inserts a story and persists any `TopicInput`s via `Topic` + `StoryTopic`.
    - `getUnsentRelevantStories()` — loads unsent, unsuppressed stories, refreshes relevance using `computeRelevanceScore`, sorts by relevance then HN score.
    - `markStoryAsSent(id)` — marks a story as notified and sets `lastNotifiedAt`.
    - `hasStoryBeenProcessed(id)` — dedup guard.
    - `getStoriesForDate(date)` — convenience query.
    - **`setStoryRating(id, rating)`** — sets the review state (`"useful" | "skip" | "bookmark" | null`) for a story. Used by the dashboard to track human review decisions.
  - Topic helpers:
    - `TopicInput` has `name`, `source` (`'title' | 'content' | 'metadata'`), and optional `weight`.
    - When `weight` is omitted, it defaults to `SCORE_SCALE * DEFAULT_TOPIC_WEIGHT_RATIO`.
  - Type export: `StoryRating = 'useful' | 'skip' | 'bookmark' | null`.

### Feedback, scoring, and dashboard
- `src/feedback.ts`
  - Types: `FeedbackAction` (`LIKE`, `DISLIKE`, `SAVE`, `OPENED`, `IGNORED`), `FeedbackConfidence` (`explicit`, `implicit`), `FeedbackSource` (`pushover`, `system`, `dashboard`).
  - Link signing:
    - `buildSignedFeedbackLink()` builds `/api/feedback` URLs with `storyId`, `action`, `confidence`, `source`, `ts`, `sig`.
    - HMAC secret comes from `FEEDBACK_SECRET` (preferred) or `PUSHOVER_API_TOKEN`.
    - `verifyFeedbackSignature()` enforces TTL via `FEEDBACK_TTL_HOURS` (or server override) and constant-time signature comparison.
  - Relevance computation:
    - Uses scaled integer scores (`SCORE_SCALE = 100`) with separate explicit/implicit weight maps.
    - Applies exponential time decay (`DECAY_HALF_LIFE_HOURS`), domain bias (`TAG_ADJUSTMENT_FACTOR`), and source bias (`SOURCE_ADJUSTMENT_FACTOR`).
    - Suppresses low-scoring stories when below `SUPPRESSION_THRESHOLD`, for a duration derived from score magnitude; clears suppression if scores recover.
  - Persistence:
    - `recordFeedbackEvent()` inserts a `FeedbackEvent`, recomputes relevance/suppression on the parent `Story`, and increments associated `Topic.score` values proportionally.

- `src/notifier.ts`
  - Reads `PUSHOVER_USER_KEY` and `PUSHOVER_API_TOKEN`; if missing, logs and prints notifications to the log instead of calling Pushover.
  - `sendNotification()` sends HTML-enabled messages to Pushover.
  - `sendStoryNotification()` builds a rich story message (title link, reason, relevance + HN score) and appends HTML feedback links where signing is configured.
  - `sendErrorNotification()` delivers summarized fatal errors via Pushover when possible.

- `src/feedbackServer.ts`
  - Starts a small HTTP server unless `DISABLE_FEEDBACK_SERVER === 'true'`.
  - Environment:
    - `FEEDBACK_PORT` (default `3000`), `FEEDBACK_HOST` (default `0.0.0.0`).
    - `FEEDBACK_TTL_HOURS` (TTL for link validity, default `36`).
    - `FEEDBACK_SERVER_TTL_HOURS` (optional separate TTL for how long the server stays up).
    - `FEEDBACK_ALLOW_ORIGIN` (CORS header, `*` by default).
  - Endpoints:
    - `GET /` — Renders the dashboard HTML via `renderHomePage()`.
    - `GET /api/stories` — JSON pagination API used by the dashboard or external tooling.
    - `GET /api/feedback` — Processes signed feedback links, verifies HMAC + TTL, records feedback, and returns a human-readable HTML response.
    - `POST /api/trigger-fetch` — Mutex-guarded; kicks off `fetchAndFilterStories()` once and returns a JSON status (`ok` or `busy`).
    - `POST /api/submit-feedback` — JSON endpoint for dashboard inline feedback; records feedback and returns updated relevance info.

- `src/dashboard.ts`
  - `getStoriesPaginated()` wraps Prisma for server-side pagination, status filtering, search, and sorting by `firstSeenAt`, `score`, `relevanceScore`, or `date`.
  - **New filtering capabilities:**
    - `rating`: Filter by review state (`unrated`, `all`, `useful`, `skip`, `bookmark`).
    - `sources`: Array of source IDs to filter by (e.g., `['hackernews', 'github_blog']`).
    - `topics`: Array of topic names to filter by (e.g., `['typescript', 'react']`).
  - `extractSourceFromStoryId()` extracts the source identifier from story IDs (format: `source:id`).
  - Returns `PaginatedResult` including `availableSources` and `availableTopics` for building filter UI.
  - `renderHomePage()` returns a single-page HTML dashboard with:
    - **Review state emphasis:** Unrated items highlighted with yellow background, rated items visually receded with reduced opacity.
    - **Multi-select filters:** Source and topic filters using chip/pill UI (top 20 topics shown).
    - **Inline metadata:** Source tags, topics (limit 2-3), and match reason displayed in each row.
    - **Rating actions:** Buttons for "useful" (✓), "skip" (✗), and "bookmark" (⭐) for unrated items; static display for rated items.
    - Table of stories (HN score, rating badge, notification status, topics, first seen).
    - A "Trigger Fetch" button that POSTs to `/api/trigger-fetch`.
  - `renderResponse()` renders a simple card-style HTML response for feedback outcomes.

- `src/topicExtractor.ts`
  - Performs deterministic, content-grounded topic extraction using title, URL, headings, body text, and heuristics (stop-word filtering, phrase ranking).
  - Returns an `ExtractedTopics` structure (`candidates`, `finalTopics`, `confirmed`, `removed`, `added`) and logs what was kept/removed.
  - **Current wiring:** Helpers are available but ingestion currently saves stories without passing `TopicInput[]`. To add topics, call `extractTopics(title, url, content)` during ingestion and pass converted topics into `saveStory()`.

- `src/logger.ts`
  - Central logging utility; use `logger.info`, `logger.warn`, `logger.error` consistently instead of `console.*`.
  - **PM2-compatible implementation:** Uses direct stream writes (`process.stdout.write`, `process.stderr.write`) instead of `console.log` to ensure immediate log visibility in PM2 monit/logs.
  - Disables stdout buffering on startup for real-time log output.
  - Uses ISO timestamps for consistency across environments.

## HTTP Endpoints Summary
- `GET /`
  - Renders the HTML dashboard with filters, pagination, a "Trigger Fetch" button, and inline rating controls.
  - Query params: `page`, `limit`, `notificationSent`, `search`, `sortBy`, `sortOrder`, `rating`, `sources[]`, `topics[]`.
  - New filtering capabilities:
    - `rating`: Filter by review state (`unrated`, `all`, `useful`, `skip`, `bookmark`). Defaults to `unrated`.
    - `sources[]`: Multi-select filter by source ID (e.g., `hackernews`, `github_blog`, `substack:username`).
    - `topics[]`: Multi-select filter by topic name (e.g., `typescript`, `react`).

- `GET /api/stories`
  - Returns paginated stories as JSON using the same filtering/sorting parameters as `/`.
  - Includes `availableSources` and `availableTopics` arrays in the response for building filter UI.

- `GET /api/feedback`
  - Accepts signed feedback links (`storyId`, `action`, `confidence`, `source`, `ts`, `sig`).
  - Verifies HMAC + TTL and records feedback via `recordFeedbackEvent()`.
  - Responds with HTML summarizing the new relevance score and any suppression state, or an error/expiry message.

- `POST /api/trigger-fetch`
  - Triggers a single ingestion + notification run. Guarded by `isFetchRunning` to avoid concurrent runs.
  - Responds immediately with JSON `{ status: "ok" | "busy", message }`; ingestion continues in the background.

- `POST /api/submit-feedback`
  - JSON body: `{ storyId, action }` (dashboard-level semantics mapped onto `FeedbackAction`).
  - Records explicit feedback from the dashboard (`source = 'dashboard'`) and returns the updated `relevanceScore` and `suppressedUntil` when available.

- `POST /api/submit-rating`
  - JSON body: `{ storyId, rating }` where `rating` is `"useful" | "skip" | "bookmark" | null`.
  - Sets the review state for a story via `setStoryRating()` in `src/storage.ts`.
  - Returns JSON `{ status: "ok", message, rating }`.
  - Used by the dashboard to record human review decisions without affecting relevance scoring.

## Environment & Running
- Environment variables
  - General / LLM
    - `OLLAMA_BASE_URL` — base URL for Ollama (default `http://localhost:11434`).
    - `OLLAMA_MODEL` — model for relevance filtering (default `functiongemma`).
    - `BROWSING_MODEL` — smaller model for fallback browsing decisions (default `qwen:0.5b`).
    - `HEADLESS` — `'true'` (default) for headless Playwright; set to `'false'` for debugging.
  - Pushover & feedback
    - `PUSHOVER_USER_KEY`, `PUSHOVER_API_TOKEN` — credentials for Pushover; if missing, notifications log instead of sending.
    - `FEEDBACK_SECRET` — HMAC secret for `/api/feedback` links (preferred over using the API token).
    - `FEEDBACK_BASE_URL` — public base URL used in signed feedback links; falls back to `http://localhost:${FEEDBACK_PORT}`.
    - `FEEDBACK_PORT`, `FEEDBACK_HOST`, `FEEDBACK_TTL_HOURS`, `FEEDBACK_SERVER_TTL_HOURS`, `FEEDBACK_ALLOW_ORIGIN`.
    - `DISABLE_FEEDBACK_SERVER` — set to `'true'` to skip starting the HTTP server.
  - Ingestion & sources
    - `HACKERNOON_TAG_URL` — override default Hackernoon tag page.
    - `HACKERNOON_SEED_URLS`, `HACKERNOON_DOMAIN_ALLOWLIST` — CSV lists for Hackernoon structured/fallback settings.
    - `ENABLE_GITHUB_BLOG` — set to `'false'` to disable the GitHub Blog structured source (default: `'true'`).
    - `GITHUB_BLOG_DOMAIN_ALLOWLIST` — optional CSV allowlist for GitHub Blog scraping (defaults to `github.blog`).
    - `ENABLE_ADDY_OSMANI_BLOG` — set to `'false'` to disable the Addy Osmani Blog structured source (default: `'true'`).
    - `SUBSTACK_USERNAMES` — CSV list of Substack usernames to ingest (e.g., `'addyo,example'`). Each username creates a separate source `substack:{username}`.
    - `FALLBACK_SEED_URLS`, `FALLBACK_DOMAIN_ALLOWLIST` — CSV lists for generic fallback browsing.
    - `FALLBACK_MAX_PAGES`, `FALLBACK_MAX_CLICKS`, `FALLBACK_MAX_DEPTH`, `FALLBACK_MAX_CANDIDATES`.
    - `FALLBACK_TIMEOUT_MS`, `FALLBACK_NAV_TIMEOUT_MS`, `FALLBACK_DECISION_TIMEOUT_MS`, `FALLBACK_USER_AGENT`.
  - Database
    - `DATABASE_URL` — optional; if unset, defaults to `file:db/hn.sqlite` (created on demand).

- Running locally
  - Development (TypeScript, ts-node):
    - `npm install`
    - `npx playwright install chromium`
    - `cp .env.example .env` (or `.env.local`) and fill in values.
    - `npm run dev` — runs `src/index.ts`, which starts the feedback server + dashboard; trigger ingestion via the dashboard or `curl -X POST /api/trigger-fetch`.
  - Production / compiled binary:
    - `npm run build` (or `npm run package:*` targets) builds to `dist/` and/or standalone binaries.
    - `npm start` — runs `node dist/index.js` using the same environment.
  - **Production with PM2 (recommended):**
    - `npm install -g pm2` — install PM2 globally
    - `npm run build` — compile the application
    - `pm2 start ecosystem.config.js` — start with PM2 using the provided config
    - `pm2 monit` — view live logs and monitoring
    - `pm2 logs hackernews-insights` — view application logs
    - See `PM2_GUIDE.md` for complete PM2 usage instructions
  - Prisma / schema sync:
    - `npm run prisma:generate` — generate Prisma client.
    - `npm run prisma:deploy` — apply migrations or push schema in environments without migration history.

## Coding Conventions / Rules for the Assistant
1. Use existing project patterns: prefer `logger` over `console`, and use `async/await` consistently.
2. Keep edits minimal and focused: change only the files necessary for the task and avoid opportunistic refactors.
3. When adding imports, use relative paths consistent with nearby files; do not introduce new external dependencies unless explicitly requested.
4. When modifying the DB schema (`prisma/schema.prisma`), coordinate with the user on migrations and keep `storage.ts`/query code in sync.
5. Do not reformat unrelated files; keep types explicit and avoid one-letter variable names.
6. Preserve the ingestion + feedback invariants:
   - Always go through `checkRelevance()` for LLM-based gating rather than introducing ad-hoc filters.
   - Respect the single-run guard around `/api/trigger-fetch`.

## Logging & Errors
- Use `logger.info`, `logger.warn`, `logger.error` for messages; do **not** add raw `console.*` in source files.
- Prefer structured, contextual log messages (include story IDs, source IDs, and URLs where useful) but avoid logging secrets.

## Security & Secrets
- Do not expose secrets (tokens, feedback HMAC secrets, database URLs with credentials) in commits, logs, or error messages.
- Always rely on environment variables and `.env`/`.env.local`; direct users to update those files for local testing.
- Treat `FEEDBACK_SECRET` as the primary HMAC key and avoid reusing Pushover credentials elsewhere.

## Assistant-specific Instruction
- Read this file at the start of every session.
- When proposing code changes, always summarize which files you touched and why in the final message.
- For multi-step changes, create a short todo list and mark progress.
- If you add new sources, endpoints, or feedback fields, update this file to keep the runtime documentation accurate.

---

If you need a more detailed contributor guide or CI instructions, ask and I will add them to this file.
