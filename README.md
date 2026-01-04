# Hacker News Insights Agent

An autonomous agent that scrapes Hacker News, filters stories based on your interests using a local LLM (FunctionGemma via Ollama), and sends a daily summary via Pushover. Designed to run on low-resource hardware like a Raspberry Pi.

## 🚀 Quick Install (Raspberry Pi)

Run this single command on your Raspberry Pi:

```bash
curl -sSL https://raw.githubusercontent.com/ukrocks007/hackernews-insights/main/install.sh | bash
```

The installer will:
- Download the pre-built binary
- Install Playwright browsers
- Prompt for your interests
- Configure Ollama and Pushover settings
- Set up a cron job for automatic runs

### Uninstall

```bash
curl -sSL https://raw.githubusercontent.com/ukrocks007/hackernews-insights/main/install.sh | bash -s -- --uninstall
```

---

## Features

- **Headless Browsing**: Uses Playwright to scrape HN safely.
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
      HEADLESS=true
      ```
    - Edit `config/interests.json` to define your topics of interest.

3.  **Build**:
    ```bash
    npm run build
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
    0 8 * * * cd /path/to/hackernews-insights && /usr/bin/node dist/index.js >> /path/to/hackernews-insights/cron.log 2>&1
    ```

## Project Structure

- `src/hnScraper.ts`: Playwright logic for scraping HN.
- `src/relevanceAgent.ts`: Ollama interaction for filtering stories.
- `src/storage.ts`: SQLite database operations.
- `src/notifier.ts`: Pushover notification logic.
- `src/index.ts`: Main orchestrator.
- `config/interests.json`: User interests configuration.
