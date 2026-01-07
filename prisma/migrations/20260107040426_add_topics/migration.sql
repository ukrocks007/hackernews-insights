-- CreateTable
CREATE TABLE "topics" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "story_topics" (
    "story_id" INTEGER NOT NULL,
    "topic_id" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("story_id", "topic_id"),
    CONSTRAINT "story_topics_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "story_topics_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "topics_name_key" ON "topics"("name");
