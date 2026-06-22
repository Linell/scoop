-- Make published_at nullable. Previously a story with no parseable feed date was
-- stamped with the fetch time, which faked freshness: adding a feed full of
-- dateless items shoved them all to the top of Fresh Scoops. NULL now means
-- "the feed gave us no usable publish date", and the read path falls back to
-- created_at for ordering instead of pretending the story is brand new.
--
-- SQLite can't drop a NOT NULL constraint in place, so rebuild the table.

ALTER TABLE stories RENAME TO stories_old;

CREATE TABLE stories (
  id           TEXT PRIMARY KEY,
  feed_id      TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  title        TEXT NOT NULL,
  author       TEXT,
  content      TEXT,
  published_at INTEGER,                  -- NULL = feed gave us no usable date
  created_at   INTEGER NOT NULL,
  summary      TEXT
);

INSERT INTO stories
  SELECT id, feed_id, url, title, author, content, published_at, created_at, summary
  FROM stories_old;

DROP TABLE stories_old;

CREATE INDEX IF NOT EXISTS stories_feed_published
  ON stories (feed_id, published_at DESC);
