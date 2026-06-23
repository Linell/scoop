-- When a reader last clicked through to a story. Stamped by the `score-click`
-- job so the click anchors onto the story within the reader's browse/
-- conversation session. NULL means no one has clicked this story yet.

ALTER TABLE stories ADD COLUMN last_clicked_at INTEGER;
