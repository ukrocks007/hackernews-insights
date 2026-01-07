# AI Assistant — Project Context & Coding Guidelines

This file is intended to be read by the assistant at the start of each session to provide core context and instructions for working on this repository.

---

## Project Overview
- Name: hackernews-insights
- Purpose: Scrape Hacker News, score/story relevance, extract content-grounded topics, and send notifications (Pushover). Includes a signed feedback loop and a small feedback web server.
- Key runtime behaviors:
  - `startFeedbackServer()` starts a small HTTP endpoint exposing `/api/feedback` and `/api/trigger-fetch`.
  - Story extraction and notification logic lives in `src/insightTracker.ts` and `src/index.ts` (entrypoint).
  - Storage and persistence use Prisma (see `prisma/` and `src/prismaClient.ts`).

## Important Files
- `src/index.ts` — main entry and exported `fetchAndFilterStories()` used by trigger endpoint.
- `src/insightTracker.ts` — story scraping, content extraction, relevance checking, and notification flow.
- `src/feedbackServer.ts` — feedback endpoint and trigger endpoint for `fetchAndFilterStories()`.
- `src/feedback.ts` — signing/verification and feedback persistence logic.
- `src/storage.ts` — Prisma-backed storage helpers.
- `src/topicExtractor.ts` — content-grounded topic extraction logic.
- `src/logger.ts` — single `logger` used across the codebase; prefer `logger.info/warn/error`.

## Environment & Running
- Environment variables live in `.env.local` (or `.env`) — do not hardcode secrets.
- Use `npm run dev` (calls `ts-node src/index.ts`) for development.
- For migrations: `npx prisma migrate dev --name <name>` and `npm run prisma:generate` as needed.

## Coding Conventions / Rules for the Assistant
1. Use existing project patterns: prefer `logger` over `console` and `async/await` style.
2. Keep edits minimal and focused: change only the files necessary for the task.
3. When adding imports, use relative paths consistent with other files and avoid introducing new dependencies unless requested.
4. When modifying DB schema, include a matching Prisma migration (`npx prisma migrate dev`) and update `prisma/schema.prisma` only when required.
5. Tests and format: do not reformat unrelated files. If adding code, keep types consistent and avoid one-letter variable names.

## Behavior Expectations for Endpoints
- `/api/feedback` (GET): handles signed feedback links.
- `/api/trigger-fetch` (POST): triggers `fetchAndFilterStories()` once; server ensures a single runner (mutex pattern).

## Logging & Errors
- Use `logger.info`, `logger.warn`, `logger.error` for messages. Do not add raw `console.*` in source files — the assistant should convert existing `console.*` to `logger.*` when requested.

## Security & Secrets
- Do not expose secrets in commits. Use env vars and direct users to update `.env.local` for local testing.

## Assistant-specific Instruction
- Read this file at the start of every session.
- When proposing code changes, always summarize files changed and reasoning in the final message.
- For multi-step changes, create a short todo list and mark progress.

---

If you need a more detailed contributor guide or CI instructions, ask and I will add them to this file.
