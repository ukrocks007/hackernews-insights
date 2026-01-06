-- CreateTable
CREATE TABLE "stories" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
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

-- CreateTable
CREATE TABLE "feedback_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "story_id" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" TEXT,
    CONSTRAINT "feedback_events_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "stories_notification_sent_idx" ON "stories"("notification_sent");

-- CreateIndex
CREATE INDEX "stories_date_idx" ON "stories"("date");

-- CreateIndex
CREATE INDEX "feedback_events_story_id_idx" ON "feedback_events"("story_id");
