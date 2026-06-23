-- Split the lumped click counter into the two distinct engagement signals the
-- teaser experiment cares about: opening the in-app show page (a weak signal —
-- still inside Scoop) vs clicking through to the original article (the strong
-- "the teaser made me want to read it" signal). Each is scored as its own
-- per-variant magnitude (avg per run). `click_count` (0010) is superseded by
-- these and left in place rather than dropped. NOT NULL DEFAULT 0 so existing
-- rows start at zero.

ALTER TABLE stories ADD COLUMN open_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stories ADD COLUMN clickthrough_count INTEGER NOT NULL DEFAULT 0;
