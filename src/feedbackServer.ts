import http, { Server } from "http";
import { URL } from "url";
import fs from "fs";
import path from "path";
import {
  FeedbackAction,
  FeedbackConfidence,
  FeedbackSource,
  recordFeedbackEvent,
  toDisplayScore,
  verifyFeedbackSignature,
} from "./feedback";
import { disconnectPrisma, initPrisma } from "./prismaClient";
import { fetchAndFilterStories } from "./insightTracker";
import { getStoriesPaginated, renderResponse } from "./dashboard";
import logger from "./logger";

// Track running state for fetchAndFilterStories
let isFetchRunning = false;

interface FeedbackServerOptions {
  port?: number;
  host?: string;
  ttlHours?: number;
}

export async function startFeedbackServer(
  options: FeedbackServerOptions = {},
): Promise<Server | null> {
  if (process.env.DISABLE_FEEDBACK_SERVER === "true") return null;

  await initPrisma();

  const port = options.port ?? Number(process.env.FEEDBACK_PORT || 3000);
  const host = options.host ?? (process.env.FEEDBACK_HOST || "0.0.0.0");
  const ttlHours =
    options.ttlHours ?? Number(process.env.FEEDBACK_TTL_HOURS || 36);
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

      const url = new URL(
        req.url,
        `http://${req.headers.host || `localhost:${port}`}`,
      );
      const allowedOrigin = process.env.FEEDBACK_ALLOW_ORIGIN || "*";
      if (allowedOrigin) {
        res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
      }

      // Serve static files
      if (url.pathname === "/" && req.method === "GET") {
        const filePath = path.join(process.cwd(), "public", "index.html");
        fs.readFile(filePath, "utf8", (err, data) => {
          if (err) {
            res
              .writeHead(500, { "Content-Type": "text/plain" })
              .end("Internal Server Error");
            return;
          }
          res.writeHead(200, { "Content-Type": "text/html" }).end(data);
        });
        return;
      }

      if (url.pathname === "/styles.css" && req.method === "GET") {
        const filePath = path.join(process.cwd(), "public", "styles.css");
        fs.readFile(filePath, "utf8", (err, data) => {
          if (err) {
            res
              .writeHead(500, { "Content-Type": "text/plain" })
              .end("Internal Server Error");
            return;
          }
          res.writeHead(200, { "Content-Type": "text/css" }).end(data);
        });
        return;
      }

      if (url.pathname === "/script.js" && req.method === "GET") {
        const filePath = path.join(process.cwd(), "public", "script.js");
        fs.readFile(filePath, "utf8", (err, data) => {
          if (err) {
            res
              .writeHead(500, { "Content-Type": "text/plain" })
              .end("Internal Server Error");
            return;
          }
          res
            .writeHead(200, { "Content-Type": "application/javascript" })
            .end(data);
        });
        return;
      }

      // API endpoint to get stories as JSON
      if (url.pathname === "/api/stories" && req.method === "GET") {
        const page = Math.max(
          1,
          parseInt(url.searchParams.get("page") || "1", 10),
        );
        const limit = Math.min(
          100,
          Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)),
        );
        const notificationSentParam = url.searchParams.get("notificationSent");
        const search = url.searchParams.get("search") || "";
        const sortBy = (url.searchParams.get("sortBy") || "firstSeenAt") as
          | "date"
          | "score"
          | "relevanceScore"
          | "firstSeenAt";
        const sortOrder = (url.searchParams.get("sortOrder") || "desc") as
          | "asc"
          | "desc";
        const rating = url.searchParams.get("rating") || "unrated";
        const sources = url.searchParams.getAll("sources").filter((s) => s);
        const topics = url.searchParams.getAll("topics").filter((t) => t);

        let notificationSent: boolean | null = null;
        if (notificationSentParam === "true") notificationSent = true;
        else if (notificationSentParam === "false") notificationSent = false;

        const data = await getStoriesPaginated({
          page,
          limit,
          notificationSent,
          search,
          sortBy,
          sortOrder,
          rating,
          sources,
          topics,
        });
        res
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify(data));
        return;
      }

      // Feedback endpoint
      if (url.pathname === "/api/feedback" && req.method === "GET") {
        // ...existing code...
        const storyId = url.searchParams.get("storyId") || "";
        const action = (url.searchParams.get("action") || "") as FeedbackAction;
        const confidence = (url.searchParams.get("confidence") ||
          "explicit") as FeedbackConfidence;
        const source = (url.searchParams.get("source") ||
          "pushover") as FeedbackSource;
        const timestamp = Number(url.searchParams.get("ts"));
        const signature = url.searchParams.get("sig") || "";

        if (!storyId || !action || !timestamp || !signature) {
          res
            .writeHead(400, { "Content-Type": "text/html" })
            .end(
              renderResponse("This feedback link is invalid or missing data."),
            );
          return;
        }
        const verified = verifyFeedbackSignature(
          storyId,
          action,
          confidence,
          source,
          timestamp,
          signature,
          ttlHours,
        );
        if (!verified) {
          res
            .writeHead(410, { "Content-Type": "text/html" })
            .end(renderResponse("This feedback link has expired."));
          return;
        }

        const result = await recordFeedbackEvent({
          storyId,
          action,
          confidence,
          source,
        });
        if (!result) {
          res
            .writeHead(200, { "Content-Type": "text/html" })
            .end(renderResponse("Feedback received. Thank you!"));
          return;
        }

        const scoreText = toDisplayScore(result.relevanceScore);
        const suppressionText = result.suppressedUntil
          ? `Temporarily snoozed until ${result.suppressedUntil.toLocaleString()}.`
          : "Story remains eligible for notifications.";

        res
          .writeHead(200, { "Content-Type": "text/html" })
          .end(
            renderResponse(
              `Saved your feedback (${action}). Current score: ${scoreText}. ${suppressionText}`,
            ),
          );
        return;
      }

      // Trigger fetch endpoint
      if (url.pathname === "/api/trigger-fetch" && req.method === "POST") {
        if (isFetchRunning) {
          res.writeHead(429, { "Content-Type": "application/json" }).end(
            JSON.stringify({
              status: "busy",
              message: "Fetch already running.",
            }),
          );
          return;
        }
        isFetchRunning = true;
        fetchAndFilterStories().finally(() => {
          isFetchRunning = false;
        });
        res
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ status: "ok", message: "Fetch completed." }));
        return;
      }

      // Submit feedback endpoint (from dashboard)
      if (url.pathname === "/api/submit-feedback" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", async () => {
          try {
            const { storyId, action } = JSON.parse(body);
            if (!storyId || !action) {
              res
                .writeHead(400, { "Content-Type": "application/json" })
                .end(
                  JSON.stringify({
                    status: "error",
                    message: "Missing storyId or action",
                  }),
                );
              return;
            }

            const result = await recordFeedbackEvent({
              storyId,
              action: action as FeedbackAction,
              confidence: "explicit",
              source: "dashboard",
            });

            if (!result) {
              res
                .writeHead(200, { "Content-Type": "application/json" })
                .end(
                  JSON.stringify({
                    status: "ok",
                    message: "Feedback recorded",
                  }),
                );
              return;
            }

            res.writeHead(200, { "Content-Type": "application/json" }).end(
              JSON.stringify({
                status: "ok",
                message: "Feedback saved",
                relevanceScore: result.relevanceScore,
                suppressedUntil: result.suppressedUntil,
              }),
            );
          } catch (error) {
            logger.error("Error processing feedback submission", error);
            res
              .writeHead(500, { "Content-Type": "application/json" })
              .end(JSON.stringify({ status: "error", message: String(error) }));
          }
        });
        return;
      }

      // Submit rating endpoint (from dashboard)
      if (url.pathname === "/api/submit-rating" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", async () => {
          try {
            const { storyId, rating } = JSON.parse(body);
            if (!storyId) {
              res
                .writeHead(400, { "Content-Type": "application/json" })
                .end(
                  JSON.stringify({
                    status: "error",
                    message: "Missing storyId",
                  }),
                );
              return;
            }

            // Validate rating
            const validRatings = ["useful", "skip", "bookmark", null];
            if (rating !== null && !validRatings.includes(rating)) {
              res
                .writeHead(400, { "Content-Type": "application/json" })
                .end(
                  JSON.stringify({
                    status: "error",
                    message: "Invalid rating value",
                  }),
                );
              return;
            }

            const { setStoryRating } = await import("./storage");
            await setStoryRating(storyId, rating);

            res.writeHead(200, { "Content-Type": "application/json" }).end(
              JSON.stringify({
                status: "ok",
                message: "Rating saved",
                rating,
              }),
            );
          } catch (error) {
            logger.error("Error processing rating submission", error);
            res
              .writeHead(500, { "Content-Type": "application/json" })
              .end(JSON.stringify({ status: "error", message: String(error) }));
          }
        });
        return;
      }

      // Generate TLDR endpoint
      if (url.pathname === "/api/generate-tldr" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", async () => {
          try {
            const { storyId } = JSON.parse(body);
            if (!storyId) {
              res
                .writeHead(400, { "Content-Type": "application/json" })
                .end(
                  JSON.stringify({
                    status: "error",
                    message: "Missing storyId",
                  }),
                );
              return;
            }

            const { getPrismaClient } = await import("./prismaClient");
            const prisma = getPrismaClient();

            // Get story details
            const story = await prisma.story.findUnique({
              where: { id: storyId },
              select: { url: true, tldr: true, title: true },
            });

            if (!story) {
              res
                .writeHead(404, { "Content-Type": "application/json" })
                .end(
                  JSON.stringify({
                    status: "error",
                    message: "Story not found",
                  }),
                );
              return;
            }

            if (!story.url) {
              res.writeHead(400, { "Content-Type": "application/json" }).end(
                JSON.stringify({
                  status: "error",
                  message: "TLDR unavailable for this article.",
                }),
              );
              return;
            }

            // Check if TLDR already exists
            if (story.tldr) {
              res.writeHead(200, { "Content-Type": "application/json" }).end(
                JSON.stringify({
                  status: "ok",
                  tldr: story.tldr,
                  cached: true,
                }),
              );
              return;
            }

            // Generate new TLDR
            logger.info(`Generating TLDR for story ${storyId}`);

            const { generateTLDRForURL } = await import("./tldrGenerator");
            const result = await generateTLDRForURL(story.url);

            if (!result) {
              res.writeHead(500, { "Content-Type": "application/json" }).end(
                JSON.stringify({
                  status: "error",
                  message: "TLDR unavailable for this article.",
                }),
              );
              return;
            }

            // Save TLDR to database
            const { saveTLDR } = await import("./storage");
            await saveTLDR(storyId, result);

            res.writeHead(200, { "Content-Type": "application/json" }).end(
              JSON.stringify({
                status: "ok",
                tldr: result.tldr,
                cached: false,
                model: result.model,
                contentLength: result.contentLength,
              }),
            );
          } catch (error) {
            logger.error("Error generating TLDR", error);
            res.writeHead(500, { "Content-Type": "application/json" }).end(
              JSON.stringify({
                status: "error",
                message: "TLDR unavailable for this article.",
              }),
            );
          }
        });
        return;
      }

      // Default: 404 for other endpoints
      res
        .writeHead(404, { "Content-Type": "application/json" })
        .end(JSON.stringify({ status: "not_found" }));
      return;
    } catch (error) {
      logger.error("Feedback server error", error);
      res
        .writeHead(500, { "Content-Type": "application/json" })
        .end(JSON.stringify({ status: "error", message: String(error) }));
    }
  });

  server.listen(port, host, () => {
    logger.info(`Feedback server listening on http://${host}:${port}`);
  });

  if (serverTtlHours > 0) {
    const shutdownTimer = setTimeout(
      () => {
        logger.info(
          `Shutting down feedback server after ${serverTtlHours}h window.`,
        );
        server.close();
        disconnectPrisma().catch((error) => {
          logger.error(
            "Failed to disconnect Prisma during feedback server shutdown",
            error,
          );
        });
      },
      serverTtlHours * 60 * 60 * 1000,
    );
    shutdownTimer.unref();
    server.on("close", () => clearTimeout(shutdownTimer));
  }

  return server;
}
