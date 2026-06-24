import { env } from "cloudflare:workers";
import {
	fetchAndParseFeed,
	hashId,
	normalizeUrl,
	type ParsedFeed,
} from "#/lib/rss";
import type { CatalogFeed, Feed, Story } from "#/lib/types";
import { faviconUrl } from "#/lib/url";

/**
 * D1 data access for the shared catalog. Everything keys off a URL hash so the
 * same feed/story is stored once and shared across all visitors (and, later,
 * shares one set of summaries + scores). No per-user rows live here.
 */

const db = () => env.DB;

// Newest N stories we keep visible per feed. Plenty for a demo; keeps cards fresh.
const STORIES_PER_FEED = 40;

// Soft cap: how many stories one feed may hold in the main (recency-ordered)
// band before its surplus is demoted to the tail. This thins a chatty or
// freshly-imported feed that would otherwise clump a run of cards together,
// without ever promoting an older story above a newer one — surplus only
// moves down.
const MAX_PER_FEED = 3;

type FeedRow = {
	id: string;
	feed_url: string;
	title: string;
	site_url: string | null;
	description: string | null;
	fetched_at: number;
};

type StoryRow = {
	id: string;
	feed_id: string;
	url: string;
	discussion_url: string | null;
	title: string;
	author: string | null;
	content: string | null;
	image_url: string | null;
	published_at: number | null;
	created_at: number;
	summary: string | null;
	served_variant: string | null;
	experiment_name: string | null;
	summarize_run_id: string | null;
	rating: "good" | "oversold" | "spoiled" | null;
	rated_at: number | null;
	click_count: number;
	save_count: number;
	open_count: number;
	clickthrough_count: number;
	discussion_count: number;
};

const toFeed = (r: FeedRow): Feed => ({
	id: r.id,
	feedUrl: r.feed_url,
	title: r.title,
	siteUrl: r.site_url,
	description: r.description,
	fetchedAt: r.fetched_at,
});

const toStory = (r: StoryRow): Story => ({
	id: r.id,
	feedId: r.feed_id,
	url: r.url,
	discussionUrl: r.discussion_url,
	title: r.title,
	author: r.author,
	content: r.content,
	imageUrl: r.image_url,
	publishedAt: r.published_at,
	summary: r.summary,
	servedVariant: r.served_variant,
	experimentName: r.experiment_name,
	summarizeRunId: r.summarize_run_id,
	rating: r.rating,
});

export type IngestResult = {
	feed: Feed;
	/** Ids of stories inserted by this ingest (i.e. not already in the catalog). */
	newStoryIds: string[];
};

/**
 * Fetch + parse a feed and write the feed row plus its stories. Stories use
 * INSERT OR IGNORE so we never clobber rows we'll later enrich with summaries.
 * Returns the stored Feed plus the ids of any newly-inserted stories, so the
 * caller can fan out a summary job per new story.
 */
export async function ingestFeed(rawUrl: string): Promise<IngestResult> {
	const feedUrl = normalizeUrl(rawUrl);
	const id = hashId(feedUrl);
	const parsed = await fetchAndParseFeed(feedUrl);
	const now = Date.now();

	await db()
		.prepare(
			`INSERT INTO feeds (id, feed_url, title, site_url, description, icon_url, fetched_at, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
			   title = excluded.title,
			   site_url = excluded.site_url,
			   description = excluded.description,
			   icon_url = COALESCE(feeds.icon_url, excluded.icon_url),
			   fetched_at = excluded.fetched_at`,
		)
		.bind(
			id,
			feedUrl,
			parsed.title,
			parsed.siteUrl,
			parsed.description,
			faviconUrl(parsed.siteUrl, feedUrl),
			now,
			now,
		)
		.run();

	const newStoryIds = await writeStories(id, parsed, now);

	return {
		feed: {
			id,
			feedUrl,
			title: parsed.title,
			siteUrl: parsed.siteUrl,
			description: parsed.description,
			fetchedAt: now,
		},
		newStoryIds,
	};
}

/** Insert each story (ignoring ones we already have); returns the new ids. */
async function writeStories(
	feedId: string,
	parsed: ParsedFeed,
	now: number,
): Promise<string[]> {
	const items = parsed.items.filter((i) => i.url);
	if (items.length === 0) return [];

	const stmt = db().prepare(
		`INSERT OR IGNORE INTO stories
		   (id, feed_id, url, discussion_url, title, author, content, image_url, published_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	);

	const ids = items.map((item) => hashId(item.guid || item.url));
	const batch = items.map((item, i) =>
		stmt.bind(
			ids[i],
			feedId,
			item.url,
			item.discussionUrl,
			item.title,
			item.author,
			item.content,
			item.imageUrl,
			item.publishedAt,
			now,
		),
	);

	// INSERT OR IGNORE reports changes: 1 for a fresh row, 0 for one we skipped,
	// so meta.changes tells us exactly which stories are new this run.
	const results = await db().batch(batch);
	return ids.filter((_, i) => results[i].meta.changes > 0);
}

// D1 allows at most 100 bound parameters per query, so an `IN (?, ?, …)` list
// can't grow without bound. We slice id lists into chunks (leaving room for the
// extra `LIMIT` param), run a query per chunk concurrently, and merge.
const ID_CHUNK = 90;

async function queryByIdChunks<Row>(
	ids: string[],
	run: (slice: string[]) => Promise<Row[]>,
): Promise<Row[]> {
	const chunks: Promise<Row[]>[] = [];
	for (let i = 0; i < ids.length; i += ID_CHUNK) {
		chunks.push(run(ids.slice(i, i + ID_CHUNK)));
	}
	return (await Promise.all(chunks)).flat();
}

/** Look up feeds by id, preserving caller order; missing ids are dropped. */
export async function getFeedsByIds(ids: string[]): Promise<Feed[]> {
	if (ids.length === 0) return [];
	const rows = await queryByIdChunks<FeedRow>(ids, async (slice) => {
		const placeholders = slice.map(() => "?").join(", ");
		const { results } = await db()
			.prepare(`SELECT * FROM feeds WHERE id IN (${placeholders})`)
			.bind(...slice)
			.all<FeedRow>();
		return results;
	});

	const byId = new Map(rows.map((r) => [r.id, toFeed(r)]));
	return ids.map((id) => byId.get(id)).filter((f): f is Feed => f != null);
}

// The story-list query fetches only the columns a card actually renders. The
// rest of a StoryRow is still typed, but the SQL never selects it — so list
// rows carry a subset of StoryRow's fields, modelled here as a partial.
type StoryCardRow = Pick<
	StoryRow,
	| "id"
	| "feed_id"
	| "url"
	| "discussion_url"
	| "title"
	| "author"
	| "image_url"
	| "published_at"
	| "created_at"
	| "summary"
	| "rating"
>;

/**
 * Map a column-restricted card row to a full Story. The list query still skips
 * the raw `content` column (kilobytes of feed HTML per row, which no card reads)
 * and fills it with null here; the detail view (getStoryById) is its only reader.
 * `image_url` is a short URL string, so the card query does select it — the feed's
 * Photos view renders it, and it's cheap enough not to undermine the lean list.
 */
const toCardStory = (r: StoryCardRow): Story => ({
	id: r.id,
	feedId: r.feed_id,
	url: r.url,
	discussionUrl: r.discussion_url,
	title: r.title,
	author: r.author,
	content: null,
	imageUrl: r.image_url,
	publishedAt: r.published_at,
	summary: r.summary,
	// The lean card query never selects the experiment columns (only the detail
	// view, getStoryById, reads them), so a card Story carries null here.
	servedVariant: null,
	experimentName: null,
	summarizeRunId: null,
	// The card does select `rating` so it can reflect a reader's prior rating;
	// pre-rating rows carry null.
	rating: r.rating,
});

/** A row's effective sort key: its publish date, or ingest time if unknown. */
const sortKey = (r: StoryCardRow): number => r.published_at ?? r.created_at;

/** Newest stories across the given feeds, most recent first. */
export async function getStoriesByFeedIds(ids: string[]): Promise<Story[]> {
	if (ids.length === 0) return [];
	const rows = await queryByIdChunks<StoryCardRow>(ids, async (slice) => {
		const placeholders = slice.map(() => "?").join(", ");
		// Limit PER FEED, not globally: rank each feed's stories by recency and
		// keep its newest STORIES_PER_FEED. A single feed whose stories all sort
		// to the top (e.g. one with no publish dates, stamped at ingest time)
		// must not consume a shared LIMIT and starve the others out of the result.
		//
		// Select only the columns a card renders — id/feed_id/url/title/author/
		// image_url/published_at/created_at/summary — never the raw `content`.
		// Feed HTML is often kilobytes per row, and at up to STORIES_PER_FEED rows
		// across every subscribed feed that's a lot of bandwidth for a column no
		// card reads. The detail page (getStoryById) is the only reader of content.
		//
		// Note: the stories_feed_published index on (feed_id, published_at DESC)
		// can't serve this ORDER BY COALESCE(published_at, created_at) DESC, so
		// SQLite sorts each partition itself rather than walking the index. A
		// deliberate tradeoff — fine at demo scale, where partitions are small.
		const { results } = await db()
			.prepare(
				`SELECT id, feed_id, url, discussion_url, title, author, image_url, published_at, created_at, summary, rating
				 FROM (
				   SELECT id, feed_id, url, discussion_url, title, author, image_url, published_at, created_at, summary, rating,
				     ROW_NUMBER() OVER (
				       PARTITION BY feed_id
				       ORDER BY COALESCE(published_at, created_at) DESC
				     ) AS rn
				   FROM stories
				   WHERE feed_id IN (${placeholders})
				 )
				 WHERE rn <= ?`,
			)
			.bind(...slice, STORIES_PER_FEED)
			.all<StoryCardRow>();
		return results;
	});

	// Each chunk is sorted on its own; re-sort once the chunks are merged.
	rows.sort((a, b) => sortKey(b) - sortKey(a));

	// Soft per-feed cap: walk the recency-ordered list, keeping the first
	// MAX_PER_FEED from each feed in the main band and demoting the rest to a
	// tail. Both bands stay in recency order, so we only ever push a feed's
	// surplus down — never lift an older story up.
	const main: StoryCardRow[] = [];
	const tail: StoryCardRow[] = [];
	const seen = new Map<string, number>();
	for (const row of rows) {
		const count = seen.get(row.feed_id) ?? 0;
		seen.set(row.feed_id, count + 1);
		(count < MAX_PER_FEED ? main : tail).push(row);
	}
	return [...main, ...tail].map(toCardStory);
}

/** Look up stories by id, preserving caller order; missing ids are dropped.
 * Mirrors getStoriesByFeedIds' lean card columns (skips the raw `content`),
 * but selects by story id directly — the reader for shared story lists. */
export async function getStoriesByIds(ids: string[]): Promise<Story[]> {
	if (ids.length === 0) return [];
	const rows = await queryByIdChunks<StoryCardRow>(ids, async (slice) => {
		const placeholders = slice.map(() => "?").join(", ");
		const { results } = await db()
			.prepare(
				`SELECT id, feed_id, url, discussion_url, title, author, image_url, published_at, created_at, summary, rating
				 FROM stories WHERE id IN (${placeholders})`,
			)
			.bind(...slice)
			.all<StoryCardRow>();
		return results;
	});

	const byId = new Map(rows.map((r) => [r.id, toCardStory(r)]));
	return ids.map((id) => byId.get(id)).filter((s): s is Story => s != null);
}

/** A single story by id (used by the summarize job). */
export async function getStoryById(id: string): Promise<Story | null> {
	const row = await db()
		.prepare(`SELECT * FROM stories WHERE id = ?`)
		.bind(id)
		.first<StoryRow>();
	return row ? toStory(row) : null;
}

/**
 * Store the AI summary for a story, along with which experiment variant served
 * it and the run that produced it. The variant + experiment name let us trace a
 * card's summary back to the teaser strategy that produced it; the run id lets
 * the parentless rating handler attribute its score to that run's variant on the
 * Inngest side (the judge does the same via its deferred parent run).
 */
export async function saveSummary(
	id: string,
	summary: string,
	experiment: { name: string; variant: string; runId: string },
): Promise<void> {
	await db()
		.prepare(
			`UPDATE stories
			 SET summary = ?, served_variant = ?, experiment_name = ?, summarize_run_id = ?
			 WHERE id = ?`,
		)
		.bind(summary, experiment.variant, experiment.name, experiment.runId, id)
		.run();
}

/**
 * Persist a reader's rating of a story's summary. The score handler maps the
 * rating to a per-variant `satisfaction` value on the Inngest side; this just
 * records the human's choice (and when) so the card can reflect it.
 */
export async function saveRating(
	id: string,
	rating: "good" | "oversold" | "spoiled",
	ratedAt: number,
): Promise<void> {
	await db()
		.prepare(`UPDATE stories SET rating = ?, rated_at = ? WHERE id = ?`)
		.bind(rating, ratedAt, id)
		.run();
}

/**
 * Stamp the time a reader last clicked a story and bump the counter for that
 * kind of click — `open` (viewed the in-app show page), `through` (clicked out
 * to the original article), or `discussion` (clicked out to the comments page) —
 * returning the new total for that kind. Anchors the click within the reader's
 * browse/conversation session; the `score-click` job is its only writer and
 * emits the returned count as a per-variant experiment score. The `+ 1` runs in
 * a single UPDATE so concurrent clicks each count once.
 */
export async function recordClick(
	id: string,
	at: number,
	kind: "open" | "through" | "discussion",
): Promise<number> {
	// `col` is a fixed literal chosen from `kind`, never user input.
	const col =
		kind === "open"
			? "open_count"
			: kind === "discussion"
				? "discussion_count"
				: "clickthrough_count";
	const row = await db()
		.prepare(
			`UPDATE stories SET last_clicked_at = ?, ${col} = ${col} + 1
			 WHERE id = ? RETURNING ${col} AS n`,
		)
		.bind(at, id)
		.first<{ n: number }>();
	return row?.n ?? 0;
}

/**
 * Bump a story's save counter and return the new total. The `score-save` job is
 * its only writer and emits the count as a per-variant experiment score; the
 * `+ 1` runs in a single UPDATE so concurrent saves each count exactly once.
 */
export async function recordSave(id: string): Promise<number> {
	const row = await db()
		.prepare(
			`UPDATE stories SET save_count = save_count + 1
			 WHERE id = ? RETURNING save_count`,
		)
		.bind(id)
		.first<{ save_count: number }>();
	return row?.save_count ?? 0;
}

/**
 * Clear a story's summary back to NULL. Used by the resummarize path: nulling
 * the column makes the card show "still churning" and lets the summarize job's
 * already-summarized guard fall through so it regenerates.
 */
export async function clearSummary(id: string): Promise<void> {
	await db()
		.prepare(`UPDATE stories SET summary = NULL WHERE id = ?`)
		.bind(id)
		.run();
}

/** Urls of the active feeds (the refresh cron's rotation). */
export async function getAllFeedUrls(): Promise<string[]> {
	const { results } = await db()
		.prepare(`SELECT feed_url FROM feeds WHERE status = 'active'`)
		.all<{ feed_url: string }>();
	return results.map((r) => r.feed_url);
}

// --- Catalog + subscriptions -----------------------------------------------
// The browsable feed catalog and the per-visitor subscriptions that promote a
// feed into the refresh rotation. A feed's status walks 'cataloged' (browsable,
// never fetched) → 'active' (has a subscriber) → 'dormant' (lost its last one).

type CatalogRow = {
	feed_url: string;
	title: string;
	site_url: string | null;
	description: string | null;
	category: string | null;
	icon_url: string | null;
	subscriber_count: number;
};

/** The whole browsable catalog, most-followed first then alphabetical. The
 *  browse dialog groups + searches client-side, so we return the lot — capped
 *  well above the current size as cheap insurance against unbounded growth. */
export async function getCatalog(): Promise<CatalogFeed[]> {
	const { results } = await db()
		.prepare(
			`SELECT f.feed_url, f.title, f.site_url, f.description, f.category, f.icon_url,
			        COUNT(s.client_id) AS subscriber_count
			 FROM feeds f
			 LEFT JOIN feed_subscriptions s ON s.feed_id = f.id
			 GROUP BY f.id
			 ORDER BY subscriber_count DESC, f.title COLLATE NOCASE
			 LIMIT 2000`,
		)
		.all<CatalogRow>();
	return results.map((r) => ({
		title: r.title,
		url: r.feed_url,
		siteUrl: r.site_url,
		description: r.description,
		category: r.category ?? "Uncategorized",
		iconUrl: r.icon_url,
		subscriberCount: r.subscriber_count,
	}));
}

/**
 * Record a visitor's subscription to a feed and promote it into the refresh
 * rotation. Returns the feed's url plus whether it still needs an initial ingest
 * (no stories yet), or null when the feed id is unknown.
 */
export async function subscribeFeed(
	clientId: string,
	feedId: string,
): Promise<{ feedUrl: string; needsIngest: boolean } | null> {
	// Look up the feed FIRST — one round-trip that also reports whether it
	// already has stories. An unknown id must never leave behind an orphan
	// subscription row (which would inflate getCatalog's subscriber_count for a
	// feed that doesn't exist).
	const feed = await db()
		.prepare(
			`SELECT f.feed_url, EXISTS(SELECT 1 FROM stories WHERE feed_id = f.id) AS has_stories
			 FROM feeds f WHERE f.id = ?`,
		)
		.bind(feedId)
		.first<{ feed_url: string; has_stories: number }>();
	if (!feed) return null;

	// Record the subscription and promote the feed in one batched (transactional)
	// round-trip. The promote only flips a non-active feed, never re-stamps an
	// active one.
	await db().batch([
		db()
			.prepare(
				`INSERT OR IGNORE INTO feed_subscriptions (client_id, feed_id, created_at)
				 VALUES (?, ?, ?)`,
			)
			.bind(clientId, feedId, Date.now()),
		db()
			.prepare(
				`UPDATE feeds SET status = 'active' WHERE id = ? AND status != 'active'`,
			)
			.bind(feedId),
	]);

	return { feedUrl: feed.feed_url, needsIngest: feed.has_stories === 0 };
}

/**
 * Drop a visitor's subscription and demote the feed to 'dormant' if that was its
 * last subscriber. Both the delete and the demote are guarded so a feed only
 * leaves the rotation when no one follows it.
 */
export async function unsubscribeFeed(
	clientId: string,
	feedId: string,
): Promise<void> {
	// One batched (transactional, ordered) round-trip: the demote's NOT EXISTS
	// observes the delete, so a feed only leaves the rotation when no one follows it.
	await db().batch([
		db()
			.prepare(
				`DELETE FROM feed_subscriptions WHERE client_id = ? AND feed_id = ?`,
			)
			.bind(clientId, feedId),
		db()
			.prepare(
				`UPDATE feeds SET status = 'dormant'
				 WHERE id = ? AND status = 'active'
				   AND NOT EXISTS (SELECT 1 FROM feed_subscriptions WHERE feed_id = ?)`,
			)
			.bind(feedId, feedId),
	]);
}

/** A single feed by id (used by submit for dedup). Null if unknown. */
export async function getFeedById(id: string): Promise<Feed | null> {
	const row = await db()
		.prepare(`SELECT * FROM feeds WHERE id = ?`)
		.bind(id)
		.first<FeedRow>();
	return row ? toFeed(row) : null;
}

/**
 * Catalog a feed WITHOUT fetching its stories: status stays 'cataloged' and
 * fetched_at is 0 until a subscribe promotes it. INSERT OR IGNORE so a submit of
 * an already-known feed is a no-op.
 */
export async function insertCatalogedFeed(args: {
	id: string;
	feedUrl: string;
	title: string;
	siteUrl: string | null;
	description: string | null;
	category: string | null;
	iconUrl: string | null;
}): Promise<void> {
	await db()
		.prepare(
			`INSERT OR IGNORE INTO feeds
			   (id, feed_url, title, site_url, description, category, icon_url, status, fetched_at, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, 'cataloged', 0, ?)`,
		)
		.bind(
			args.id,
			args.feedUrl,
			args.title,
			args.siteUrl,
			args.description,
			args.category,
			args.iconUrl,
			Date.now(),
		)
		.run();
}

/** The distinct category names present in the catalog, alphabetical. */
export async function listCategories(): Promise<string[]> {
	const { results } = await db()
		.prepare(
			`SELECT DISTINCT category FROM feeds WHERE category IS NOT NULL ORDER BY category`,
		)
		.all<{ category: string }>();
	return results.map((r) => r.category);
}

// --- Shared lists ----------------------------------------------------------
// A generic "publish an ordered set of ids under a short slug" primitive. The
// feeds path is wired up now; the stories path (with a JSON folder structure)
// reuses the same tables and is filled in by a later stage.

// Url-safe, unambiguous-ish base62. ~10 chars over 62 symbols is ~59 bits of
// slug space — plenty to avoid collisions at demo scale without a uniqueness
// retry loop.
const SLUG_ALPHABET =
	"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SLUG_LENGTH = 10;

/** A short, url-safe slug from the Workers Web Crypto global (no Node crypto). */
function makeSlug(): string {
	const bytes = new Uint8Array(SLUG_LENGTH);
	crypto.getRandomValues(bytes);
	let slug = "";
	for (const b of bytes) slug += SLUG_ALPHABET[b % SLUG_ALPHABET.length];
	return slug;
}

export type SharedListKind = "feeds" | "stories";

export type SharedList = {
	slug: string;
	kind: SharedListKind;
	title: string | null;
	structure: string | null;
	itemIds: string[];
};

type SharedListRow = {
	slug: string;
	kind: string;
	title: string | null;
	structure: string | null;
};

/**
 * Publish a list: insert the parent row plus its ordered items, returning the
 * generated slug. `structure` is stored verbatim (a JSON string for nested
 * story lists, or null for the flat feeds kind). created_at == updated_at on
 * first publish; the list is immutable for now.
 */
export async function createSharedList({
	kind,
	title,
	ownerClientId,
	itemIds,
	structure,
}: {
	kind: SharedListKind;
	title: string | null;
	ownerClientId: string | null;
	itemIds: string[];
	structure: string | null;
}): Promise<string> {
	const slug = makeSlug();
	const now = Date.now();

	const statements = [
		db()
			.prepare(
				`INSERT INTO shared_lists (slug, kind, title, owner_client_id, structure, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(slug, kind, title, ownerClientId, structure, now, now),
	];

	const itemStmt = db().prepare(
		`INSERT INTO shared_list_items (slug, item_id, position) VALUES (?, ?, ?)`,
	);
	// (slug, item_id) is the PK and the batch is one transaction, so a repeated
	// id would throw and create no list at all — dedupe, keeping first-seen order.
	const uniqueIds = [...new Set(itemIds)];
	uniqueIds.forEach((itemId, i) => {
		statements.push(itemStmt.bind(slug, itemId, i));
	});

	await db().batch(statements);
	return slug;
}

/** A published list by slug — its metadata plus item ids in position order. */
export async function getSharedList(slug: string): Promise<SharedList | null> {
	const row = await db()
		.prepare(
			`SELECT slug, kind, title, structure FROM shared_lists WHERE slug = ?`,
		)
		.bind(slug)
		.first<SharedListRow>();
	if (!row) return null;

	const { results } = await db()
		.prepare(
			`SELECT item_id FROM shared_list_items WHERE slug = ? ORDER BY position`,
		)
		.bind(slug)
		.all<{ item_id: string }>();

	return {
		slug: row.slug,
		kind: row.kind as SharedListKind,
		title: row.title,
		structure: row.structure,
		itemIds: results.map((r) => r.item_id),
	};
}
