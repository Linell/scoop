-- Shareable lists. A visitor publishes a snapshot of something they've curated
-- (right now: their feed subscriptions) under a short slug; a recipient opens
-- /l/<slug> and adds it to their own. This is the ONLY per-publisher data in
-- D1 — everything else (subscriptions, ratings, the client id) lives in the
-- browser's localStorage, keeping the "no auth" story intact. A published list
-- is a deliberate, opt-in export, so it's the one thing that has to outlive a
-- single browser.
--
-- `kind` distinguishes the flavors of list this primitive carries: 'feeds'
-- (subscription shares, wired up now) and 'stories' (reading lists, a later
-- stage). `structure` holds a verbatim JSON folder tree for the nested
-- story-list kind and is NULL for the flat feeds kind — the item rows below
-- stay the ordered source of truth either way.

CREATE TABLE shared_lists (
  slug TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT,
  owner_client_id TEXT,
  structure TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE shared_list_items (
  slug TEXT NOT NULL REFERENCES shared_lists(slug) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (slug, item_id)
);

CREATE INDEX shared_list_items_slug ON shared_list_items (slug, position);
