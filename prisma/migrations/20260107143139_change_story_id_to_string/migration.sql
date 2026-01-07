/*
  Warnings:

  - The primary key for the `stories` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `story_topics` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_feedback_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "story_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" TEXT,
    CONSTRAINT "feedback_events_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_feedback_events" ("action", "confidence", "created_at", "id", "metadata", "source", "story_id") SELECT "action", "confidence", "created_at", "id", "metadata", "source", "story_id" FROM "feedback_events";
DROP TABLE "feedback_events";
ALTER TABLE "new_feedback_events" RENAME TO "feedback_events";
CREATE INDEX "feedback_events_story_id_idx" ON "feedback_events"("story_id");
CREATE TABLE "new_stories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "score" INTEGER,
    "rank" INTEGER,
    "date" TEXT NOT NULL,
    "reason" TEXT,
    "relevance_score" INTEGER NOT NULL DEFAULT 0,
    "notification_sent" BOOLEAN NOT NULL DEFAULT false,
    "first_seen_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_notified_at" DATETIME,
    "suppressed_until" DATETIME
);
INSERT INTO "new_stories" ("date", "first_seen_at", "id", "last_notified_at", "notification_sent", "rank", "reason", "relevance_score", "score", "suppressed_until", "title", "url") SELECT "date", "first_seen_at", "id", "last_notified_at", "notification_sent", "rank", "reason", "relevance_score", "score", "suppressed_until", "title", "url" FROM "stories";
DROP TABLE "stories";
ALTER TABLE "new_stories" RENAME TO "stories";
CREATE INDEX "stories_notification_sent_idx" ON "stories"("notification_sent");
CREATE INDEX "stories_date_idx" ON "stories"("date");
CREATE TABLE "new_story_topics" (
    "story_id" TEXT NOT NULL,
    "topic_id" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("story_id", "topic_id"),
    CONSTRAINT "story_topics_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "story_topics_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_story_topics" ("source", "story_id", "topic_id", "weight") SELECT "source", "story_id", "topic_id", "weight" FROM "story_topics";
DROP TABLE "story_topics";
ALTER TABLE "new_story_topics" RENAME TO "story_topics";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
