-- A story can carry a separate discussion/comments URL distinct from its
-- article url — the standard RSS 2.0 <comments> element (Hacker News, most
-- WordPress blogs, Slashdot, …) or an Atom <link rel="replies">. Nullable:
-- existing rows and feeds without comments simply have no discussion link.
ALTER TABLE stories ADD COLUMN discussion_url TEXT;

-- Discussion clickthroughs are scored as their own engagement signal, separate
-- from article clickthroughs, so they need their own counter.
ALTER TABLE stories ADD COLUMN discussion_count INTEGER NOT NULL DEFAULT 0;
