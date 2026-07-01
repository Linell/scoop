-- Voodoo-backed accounts. Voodoo (a sibling-domain auth service) is the source
-- of truth for identity; this table is a local cache of who's signed in, keyed
-- by voodoo's own user id (never re-hashed) so a session lookup is a single
-- join-free row read. Subscriptions and saved stories move from localStorage
-- (and the old client-id-keyed feed_subscriptions table) to per-user rows here.

CREATE TABLE users (
  id         TEXT PRIMARY KEY,   -- voodoo's user id, verbatim
  email      TEXT NOT NULL UNIQUE,
  is_admin   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE user_subscriptions (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feed_id    TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  flavor     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, feed_id)
);
CREATE INDEX user_subscriptions_feed ON user_subscriptions (feed_id);

CREATE TABLE user_saved_stories (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  story_id    TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  saved_at    INTEGER NOT NULL,
  collections TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (user_id, story_id)
);
CREATE INDEX user_saved_stories_user_saved_at ON user_saved_stories (user_id, saved_at DESC);

-- Superseded by user_subscriptions now that subscribing requires a session.
-- Old rows are intentionally discarded, not migrated: they're keyed by
-- anonymous client id, which has no mapping to a voodoo user id. A fresh
-- sign-in just re-subscribes from scratch.
DROP TABLE feed_subscriptions;
