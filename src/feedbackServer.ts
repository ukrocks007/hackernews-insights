import http, { Server } from 'http';
import { URL } from 'url';
import { FeedbackAction, FeedbackConfidence, FeedbackSource, recordFeedbackEvent, toDisplayScore, verifyFeedbackSignature } from './feedback';
import { disconnectPrisma, initPrisma } from './prismaClient';

interface FeedbackServerOptions {
  port?: number;
  host?: string;
  ttlHours?: number;
}

function renderResponse(message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HN Insights</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; background:#f9fafb; color:#111827; }
    .card { max-width: 420px; margin: 0 auto; background:#fff; border-radius: 12px; padding: 20px; box-shadow: 0 6px 18px rgba(0,0,0,0.08); }
    h1 { font-size: 20px; margin: 0 0 8px 0; }
    p { margin: 0; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>HN Insights</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

export async function startFeedbackServer(options: FeedbackServerOptions = {}): Promise<Server | null> {
  if (process.env.DISABLE_FEEDBACK_SERVER === 'true') return null;

  await initPrisma();

  const port = options.port ?? Number(process.env.FEEDBACK_PORT || 3000);
  const host = options.host ?? (process.env.FEEDBACK_HOST || '0.0.0.0');
  const ttlHours = options.ttlHours ?? Number(process.env.FEEDBACK_TTL_HOURS || 36);
  const serverTtlHours =
    process.env.FEEDBACK_SERVER_TTL_HOURS !== undefined
      ? Number(process.env.FEEDBACK_SERVER_TTL_HOURS)
      : ttlHours;

  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        res.writeHead(400).end();
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host || `localhost:${port}`}`);
      const allowedOrigin = process.env.FEEDBACK_ALLOW_ORIGIN || '*';
      if (allowedOrigin) {
        res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      }

      if (url.pathname !== '/api/feedback' || req.method !== 'GET') {
        res.writeHead(404).end();
        return;
      }

      const storyId = Number(url.searchParams.get('storyId'));
      const action = (url.searchParams.get('action') || '') as FeedbackAction;
      const confidence = (url.searchParams.get('confidence') || 'explicit') as FeedbackConfidence;
      const source = (url.searchParams.get('source') || 'pushover') as FeedbackSource;
      const timestamp = Number(url.searchParams.get('ts'));
      const signature = url.searchParams.get('sig') || '';

      if (!storyId || !action || !timestamp || !signature) {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(renderResponse('This feedback link is invalid or missing data.'));
        return;
      }

      const verified = verifyFeedbackSignature(storyId, action, confidence, source, timestamp, signature, ttlHours);
      if (!verified) {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(renderResponse('This feedback link has expired.'));
        return;
      }

      const result = await recordFeedbackEvent({ storyId, action, confidence, source });
      if (!result) {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(renderResponse('Feedback received. Thank you!'));
        return;
      }

      const scoreText = toDisplayScore(result.relevanceScore);
      const suppressionText = result.suppressedUntil
        ? `Temporarily snoozed until ${result.suppressedUntil.toLocaleString()}.`
        : 'Story remains eligible for notifications.';

      res
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(renderResponse(`Saved your feedback (${action}). Current score: ${scoreText}. ${suppressionText}`));
    } catch (error) {
      console.error('Feedback endpoint error', error);
      res
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(renderResponse('We could not process your feedback right now. Please try again later.'));
    }
  });

  server.listen(port, host, () => {
    console.log(`Feedback server listening on http://${host}:${port}`);
  });

  if (serverTtlHours > 0) {
    const shutdownTimer = setTimeout(() => {
      console.log(`Shutting down feedback server after ${serverTtlHours}h window.`);
      server.close();
      disconnectPrisma().catch(error => {
        console.error('Failed to disconnect Prisma during feedback server shutdown', error);
      });
    }, serverTtlHours * 60 * 60 * 1000);
    shutdownTimer.unref();
  }

  return server;
}
