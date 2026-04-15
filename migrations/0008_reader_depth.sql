-- Migration: Reader depth — collections, highlights, annotations
-- Part of M8

-- Collections (user-created article groups)
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT,
  icon TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE(user_id, name),
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_collections_user ON collections(user_id, position);

-- Collection-article junction (many-to-many with ordering)
CREATE TABLE IF NOT EXISTS collection_articles (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE(collection_id, article_id),
  FOREIGN KEY(collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_collection_articles_collection ON collection_articles(collection_id, position);
CREATE INDEX IF NOT EXISTS idx_collection_articles_article ON collection_articles(article_id);

-- Highlights (text selections within articles)
CREATE TABLE IF NOT EXISTS article_highlights (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  selected_text TEXT NOT NULL,
  block_index INTEGER,
  text_offset INTEGER,
  text_length INTEGER,
  note TEXT,
  color TEXT DEFAULT 'yellow',
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_article_highlights_user_article ON article_highlights(user_id, article_id);

-- Annotations (per-article user notes, one per user per article)
CREATE TABLE IF NOT EXISTS article_annotations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE(user_id, article_id),
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_article_annotations_user_article ON article_annotations(user_id, article_id);
