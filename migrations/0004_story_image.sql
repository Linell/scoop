-- A representative image per story, captured from the feed at ingest time:
-- the first usable HTTPS image among the item's Media RSS / enclosure nodes or
-- its first inline <img>. We store only the absolute URL and hotlink it — the
-- publisher hosts the bytes. NULL means the feed gave us no usable image, which
-- is the common case for text feeds (HN, essays) — the detail page just omits it.

ALTER TABLE stories ADD COLUMN image_url TEXT;
