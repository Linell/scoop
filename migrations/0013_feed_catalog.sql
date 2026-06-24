-- Promote the shared `feeds` table from a hidden side-effect of adding a feed
-- into the browsable catalog itself. Two things are needed: richer display
-- metadata (a category + an icon), and a fetch-cost lifecycle so the catalog
-- can grow large while we only ever fetch + summarize feeds someone wants.

-- Display metadata. `category` is nullable: seeded feeds carry the curated
-- category, submitted feeds get one from the classifier, and a feed can sit
-- briefly uncategorized without breaking the browse grouping.
ALTER TABLE feeds ADD COLUMN category TEXT;
ALTER TABLE feeds ADD COLUMN icon_url TEXT;

-- Lifecycle:
--   'cataloged' — browsable, never fetched (the default for seeded/submitted)
--   'active'    — has a subscriber; in the 30-min refresh rotation
--   'dormant'   — was active, lost its last subscriber; keeps its old stories
-- The refresh cron fetches `status='active'` only, so the catalog's size is
-- decoupled from the fetch/summarize bill.
ALTER TABLE feeds ADD COLUMN status TEXT NOT NULL DEFAULT 'cataloged';

-- Backfill: every feed already carrying stories was added by someone, so keep
-- it active. Without this, the cron's switch to status='active' would silently
-- stop refreshing every feed existing subscribers already follow.
UPDATE feeds SET status = 'active' WHERE id IN (SELECT DISTINCT feed_id FROM stories);

-- A visitor's server-side subscription shadow. localStorage stays the UX source
-- of truth (the "no auth" story); this table exists so the catalog knows which
-- feeds have demand (→ active) and can rank by popularity. The composite PK
-- makes subscribe idempotent (INSERT OR IGNORE) and gives an exact count, so the
-- lifecycle never rides a lossy counter.
CREATE TABLE feed_subscriptions (
	client_id TEXT NOT NULL,
	feed_id TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	PRIMARY KEY (client_id, feed_id)
);

-- Counting subscribers of a feed (demote-on-last-leaver, popularity ranking).
CREATE INDEX feed_subscriptions_feed ON feed_subscriptions (feed_id);

-- The refresh cron's hot lookup is `WHERE status = 'active'`.
CREATE INDEX feeds_status ON feeds (status);
