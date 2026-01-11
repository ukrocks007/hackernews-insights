# Hacker News Insights Agent

An autonomous agent that curate Hacker News stories based on your interests using a local LLM, and sends a daily summary via Pushover. Designed to run on low-resource hardware like a Raspberry Pi.

## 🚀 Quick Install (Raspberry Pi)

Run this single command on your Raspberry Pi:

```bash
curl -sSL https://raw.githubusercontent.com/ukrocks007/hackernews-insights/main/install.sh | bash
```

The installer will:

- Install Node.js 20 and build tools (if needed)
- Clone the repository and build locally (solves native module compatibility issues)
- Install Playwright browsers
- Prompt for your interests
- Configure Ollama and Pushover settings
- Set up a cron job for automatic runs

**Why build locally?** This ensures native modules like SQLite3 are compiled for your specific architecture, avoiding binding errors.

### Uninstall

```bash
curl -sSL https://raw.githubusercontent.com/ukrocks007/hackernews-insights/main/install.sh | bash -s -- --uninstall
```

---

## Features

- **Multi-Source Ingestion**: Scrapes content from:
  - Hacker News
  - Hackernoon
  - GitHub Blog
  - Substack (config-driven for multiple authors)
  - Addy Osmani Blog
  - Optional LLM-guided fallback browsing
- **Headless Browsing**: Uses Playwright to scrape safely.
- **Local AI Filtering**: Uses Ollama (`functiongemma`) to evaluate story relevance.
- **Smart Storage**: Deduplicates stories using SQLite.
- **Notifications**: Sends concise summaries via Pushover.
- **Resilient**: Fails fast and notifies on errors.

## Prerequisites

- Node.js (v18+)
- [Ollama](https://ollama.com/) running locally or accessible via network.
- `functiongemma` model pulled in Ollama (`ollama pull functiongemma`).
- A [Pushover](https://pushover.net/) account (User Key & API Token).

## Setup

1.  **Install Dependencies**:

    ```bash
    npm install
    npx playwright install chromium
    ```

2.  **Configuration**:

- Copy `.env` example:
  ```bash
  cp .env.example .env
  ```
- Edit `.env` with your details:

  ```env
  OLLAMA_BASE_URL=http://localhost:11434
  OLLAMA_MODEL=functiongemma
  PUSHOVER_USER_KEY=your_user_key
  PUSHOVER_API_TOKEN=your_api_token
  FEEDBACK_SECRET=choose_a_long_random_string
  FEEDBACK_BASE_URL=http://your-host:3000
  FEEDBACK_PORT=3000
  FEEDBACK_TTL_HOURS=36
  HEADLESS=true

  # Optional: Configure additional content sources
  ENABLE_GITHUB_BLOG=true
  ENABLE_ADDY_OSMANI_BLOG=true
  SUBSTACK_USERNAMES=addyo,https://bytebytego.substack.com/archive?sort=new,https://becomeuncivilized.com/?sort=new  # CSV list of Substack usernames or full archive URLs
  ```

  - Edit `config/interests.json` to define your topics of interest.
  - If you deploy the feedback endpoint, expose `FEEDBACK_BASE_URL` so that Pushover links resolve back to your device.

3.  **Build**:

```bash
npm run build
```

4.  **Sync Database Schema (Prisma + SQLite)**:

```bash
npm run prisma:deploy
```

## Running Locally

To run the agent once (development mode):

```bash
npm run dev
```

To run the built version:

```bash
npm start
```

## Running via Cron (Daily)

To run this automatically every day at 8:00 AM:

1.  Build the project:

    ```bash
    npm run build
    ```

2.  Open crontab:

    ```bash
    crontab -e
    ```

3.  Add the following line (adjust paths):
    ```cron
    0 8 * * * cd /path/to/hackernews-insights && npm start >> /path/to/hackernews-insights/cron.log 2>&1
    ```

**Note:** The installer sets this up automatically for you.

## Project Structure

- `src/hnScraper.ts`: Playwright logic for scraping Hacker News.
- `src/hackernoonScraper.ts`: Playwright logic for scraping Hackernoon.
- `src/githubBlogScraper.ts`: Playwright logic for scraping GitHub Blog.
- `src/substackScraper.ts`: Generic Substack archive scraper (username-driven).
- `src/addyOsmaniBlogScraper.ts`: Playwright logic for scraping Addy Osmani's blog.
- `src/sourceRegistry.ts`: Source registration and normalization.
- `src/relevanceAgent.ts`: Ollama interaction for filtering stories.
- `src/storage.ts`: SQLite database operations.
- `src/notifier.ts`: Pushover notification logic.
- `src/index.ts`: Main orchestrator.
- `config/interests.json`: User interests configuration.
