import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';

export interface Story {
  id: number;
  title: string;
  url: string;
  score: number;
  rank: number;
  date: string;
  reason: string;
  relevance_score: number;
  notification_sent: boolean;
}

let db: Database | null = null;

export async function initDB(): Promise<void> {
  const dbPath = path.resolve(__dirname, '../db/hn.sqlite');
  
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS stories (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT,
      score INTEGER,
      rank INTEGER,
      date TEXT NOT NULL,
      reason TEXT,
      relevance_score INTEGER DEFAULT 0,
      notification_sent INTEGER DEFAULT 0
    )
  `);

  // Migration for existing tables
  try {
    await db.exec('ALTER TABLE stories ADD COLUMN relevance_score INTEGER DEFAULT 0');
  } catch (e) { /* Column likely exists */ }
  
  try {
    await db.exec('ALTER TABLE stories ADD COLUMN notification_sent INTEGER DEFAULT 0');
  } catch (e) { /* Column likely exists */ }
  
  console.log('Database initialized at', dbPath);
}

export async function saveStory(story: Story): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  
  await db.run(
    `INSERT OR IGNORE INTO stories (id, title, url, score, rank, date, reason, relevance_score, notification_sent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [story.id, story.title, story.url, story.score, story.rank, story.date, story.reason, story.relevance_score, story.notification_sent ? 1 : 0]
  );
}

export async function getUnsentRelevantStories(): Promise<Story[]> {
  if (!db) throw new Error('Database not initialized');
  // Get all unsent stories, sorted by relevance score (desc) then HN score (desc)
  const rows = await db.all('SELECT * FROM stories WHERE notification_sent = 0 ORDER BY relevance_score DESC, score DESC');
  return rows.map(row => ({
    ...row,
    notification_sent: !!row.notification_sent
  }));
}

export async function markStoryAsSent(id: number): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  await db.run('UPDATE stories SET notification_sent = 1 WHERE id = ?', id);
}

export async function hasStoryBeenProcessed(id: number): Promise<boolean> {
  if (!db) throw new Error('Database not initialized');
  
  const result = await db.get('SELECT id FROM stories WHERE id = ?', id);
  return !!result;
}

export async function getStoriesForDate(date: string): Promise<Story[]> {
  if (!db) throw new Error('Database not initialized');
  
  return await db.all('SELECT * FROM stories WHERE date = ?', date);
}

export async function closeDB(): Promise<void> {
  if (db) {
    await db.close();
    db = null;
  }
}
