// ==========================================
// NexusAI — SQLite Database Layer
// ==========================================

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'data', 'nexus.db');

export const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    -- Settings (key-value store)
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Research sources
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'text',
      summary TEXT,
      topics TEXT DEFAULT '[]',
      entity_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    -- Extracted entities
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'other',
      description TEXT,
      source_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    );

    -- Entity connections/relationships
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      source_entity TEXT NOT NULL,
      target_entity TEXT NOT NULL,
      relationship TEXT,
      source_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    );

    -- Chat messages
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- Generated reports
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source_count INTEGER DEFAULT 0,
      entity_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    -- Activity log
    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      detail TEXT,
      timestamp TEXT NOT NULL
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_entities_source ON entities(source_id);
    CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(LOWER(name));
    CREATE INDEX IF NOT EXISTS idx_connections_source ON connections(source_id);
    CREATE INDEX IF NOT EXISTS idx_connections_entities ON connections(source_entity, target_entity);
    CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_log(timestamp);
  `);

  console.log('📦 Database initialized at', DB_PATH);
}
