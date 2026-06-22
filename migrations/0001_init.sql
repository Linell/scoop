-- Scoop's shared catalog. There is no per-user data here: subscriptions live in
-- each visitor's localStorage. Feeds and stories are deduped by a stable hash of
-- their (normalized) URL so every visitor who adds the same feed shares one row —
-- and, later, one set of AI summaries + scores.

CREATE TABLE IF NOT EXISTS feeds (
  id          TEXT PRIMARY KEY,        -- hash of the normalized feed URL
  feed_url    TEXT NOT NULL UNIQUE,    -- the RSS/Atom URL we fetch
  title       TEXT NOT NULL,
  site_url    TEXT,                    -- the human-facing homepage
  description TEXT,
  fetched_at  INTEGER NOT NULL,        -- epoch ms of last successful fetch
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stories (
  id           TEXT PRIMARY KEY,       -- hash of guid || link
  feed_id      TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,          -- where the click should go
  title        TEXT NOT NULL,
  author       TEXT,
  content      TEXT,                   -- raw description/content from the feed
  published_at INTEGER NOT NULL,       -- epoch ms (falls back to fetch time)
  created_at   INTEGER NOT NULL
  -- summary + score columns land here in the next phase.
);

CREATE INDEX IF NOT EXISTS stories_feed_published
  ON stories (feed_id, published_at DESC);
