-- Experiment attribution. The summary served for a story is now one of two
-- teaser strategies, chosen per-story by an Inngest experiment. We record which
-- variant won and the experiment it belonged to so a card's summary can be
-- traced back to the strategy that produced it (the judge scores are attributed
-- to the same variant on the Inngest side). NULL on both means a pre-experiment
-- summary, written before this slice shipped.

ALTER TABLE stories ADD COLUMN served_variant TEXT;
ALTER TABLE stories ADD COLUMN experiment_name TEXT;
