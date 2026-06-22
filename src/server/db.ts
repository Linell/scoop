import { env } from "cloudflare:workers";
import {
	fetchAndParseFeed,
	hashId,
	normalizeUrl,
	type ParsedFeed,
} from "#/lib/rss";
import type { Feed, Story } from "#/lib/types";

/**
 * D1 data access for the shared catalog. Everything keys off a URL hash so the
 * same feed/story is stored once and shared across all visitors (and, later,
 * shares one set of summaries + scores). No per-user rows live here.
 */

const db = () => env.DB;

// Newest N stories we keep visible per feed. Plenty for a demo; keeps cards fresh.
const STORIES_PER_FEED = 40;

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
	title: string;
	author: string | null;
	content: string | null;
	published_at: number;
	summary: string | null;
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
	title: r.title,
	author: r.author,
	content: r.content,
	publishedAt: r.published_at,
	summary: r.summary,
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
			`INSERT INTO feeds (id, feed_url, title, site_url, description, fetched_at, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
			   title = excluded.title,
			   site_url = excluded.site_url,
			   description = excluded.description,
			   fetched_at = excluded.fetched_at`,
		)
		.bind(
			id,
			feedUrl,
			parsed.title,
			parsed.siteUrl,
			parsed.description,
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
		   (id, feed_id, url, title, author, content, published_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	);

	const ids = items.map((item) => hashId(item.guid || item.url));
	const batch = items.map((item, i) =>
		stmt.bind(
			ids[i],
			feedId,
			item.url,
			item.title,
			item.author,
			item.content,
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

/** Newest stories across the given feeds, most recent first. */
export async function getStoriesByFeedIds(ids: string[]): Promise<Story[]> {
	if (ids.length === 0) return [];
	const rows = await queryByIdChunks<StoryRow>(ids, async (slice) => {
		const placeholders = slice.map(() => "?").join(", ");
		const limit = slice.length * STORIES_PER_FEED;
		const { results } = await db()
			.prepare(
				`SELECT * FROM stories
				 WHERE feed_id IN (${placeholders})
				 ORDER BY published_at DESC
				 LIMIT ?`,
			)
			.bind(...slice, limit)
			.all<StoryRow>();
		return results;
	});

	// Each chunk is sorted on its own; re-sort once the chunks are merged.
	return rows.sort((a, b) => b.published_at - a.published_at).map(toStory);
}

/** A single story by id (used by the summarize job). */
export async function getStoryById(id: string): Promise<Story | null> {
	const row = await db()
		.prepare(`SELECT * FROM stories WHERE id = ?`)
		.bind(id)
		.first<StoryRow>();
	return row ? toStory(row) : null;
}

/** Store the AI summary for a story. */
export async function saveSummary(id: string, summary: string): Promise<void> {
	await db()
		.prepare(`UPDATE stories SET summary = ? WHERE id = ?`)
		.bind(summary, id)
		.run();
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

/** All feed urls in the catalog — used by the refresh cron. */
export async function getAllFeedUrls(): Promise<string[]> {
	const { results } = await db()
		.prepare(`SELECT feed_url FROM feeds`)
		.all<{ feed_url: string }>();
	return results.map((r) => r.feed_url);
}
