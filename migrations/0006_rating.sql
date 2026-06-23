-- Human rating of a story's summary. After reading, a visitor can mark a
-- summary as good, oversold, or spoiled; the rating is mapped to a per-variant
-- `satisfaction` score on the Inngest side and persisted here so the card UI can
-- reflect the chosen rating. NULL means no one has rated this summary yet.

ALTER TABLE stories ADD COLUMN rating TEXT;
ALTER TABLE stories ADD COLUMN rated_at INTEGER;
