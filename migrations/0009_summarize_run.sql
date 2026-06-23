-- Cross-function experiment attribution. Inngest keys an experiment's scores by
-- the function that declared its variants (here, `summarize-story` via
-- `group.experiment`). The rating path (`score-rating`) is a standalone,
-- event-driven run with no parent, so on its own its `satisfaction` score lands
-- under a separate experiment record and never reaches the served variant.
-- Persisting the summarize run id lets the rating handler target that run via
-- `score.experiment({ runId })`, so the score attributes to the right variant.
-- NULL means a summary written before this slice shipped (no run to credit).

ALTER TABLE stories ADD COLUMN summarize_run_id TEXT;
