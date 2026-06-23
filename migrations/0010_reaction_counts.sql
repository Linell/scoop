-- Per-story reaction counters, so engagement can be scored as a magnitude
-- (avg reactions per run) on the summary-strategy experiment. The experiment
-- dashboard aggregates per-variant scores with AVG, so we emit a running total
-- per story (read-then-increment on each click/save) attributed to the
-- summarize run's variant; summarize-story seeds a 0 baseline so the average
-- spans ALL summarized runs, not just the ones that drew a reaction. NOT NULL
-- DEFAULT 0 so existing rows start at zero.

ALTER TABLE stories ADD COLUMN click_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stories ADD COLUMN save_count INTEGER NOT NULL DEFAULT 0;
