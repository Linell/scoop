import { createServerFn } from "@tanstack/react-start";
import {
	// Aliased so the server fn below can keep the clean public `recordStorySave`
	// name — the emitter and the server fn would otherwise clash.
	recordStorySave as emitStorySave,
	queueStorySummaries,
	recordStoryClick,
	recordSummaryRating,
	requestFeedRefresh,
	requestResummarize,
} from "#/inngest/events";
import { FeedError, fetchAndParseFeed } from "#/lib/rss";
import type { CatalogFeed, Feed, Story } from "#/lib/types";
import { faviconUrl, hashId, normalizeUrl } from "#/lib/url";
import { classifyCategory } from "./categorize";
import {
	createSharedList,
	getCatalog as getCatalogRows,
	getFeedById,
	getFeedsByIds,
	getSharedList,
	getStoriesByFeedIds,
	getStoriesByIds,
	getStoryById,
	ingestFeed,
	insertCatalogedFeed,
	type SharedListKind,
	subscribeFeed as subscribeFeedDb,
	unsubscribeFeed as unsubscribeFeedDb,
} from "./db";

/**
 * Server functions are the client's whole API surface. They run in the Worker,
 * so they're the only place D1 is touched. Subscriptions (which feeds a visitor
 * follows) are NOT here — those live in the browser's localStorage.
 */

type AddFeedResult = { ok: true; feed: Feed } | { ok: false; error: string };

function validateUrl(input: unknown): string {
	if (typeof input !== "string" || input.trim() === "") {
		throw new Error("A feed URL is required.");
	}
	return input.trim();
}

/** A feed id + client id pair, for the subscribe/unsubscribe endpoints. */
function validateSubscription(input: unknown): {
	feedId: string;
	clientId: string;
} {
	const data = input as { feedId?: unknown; clientId?: unknown };
	const feedId = typeof data?.feedId === "string" ? data.feedId.trim() : "";
	if (feedId === "") throw new Error("A feed id is required.");
	const clientId =
		typeof data?.clientId === "string" ? data.clientId.trim() : "";
	if (clientId === "") throw new Error("A client id is required.");
	return { feedId, clientId };
}

// Cap the fan-out so a tampered client can't ask for thousands at once. Shared
// so every endpoint that takes feed ids (feeds, stories, chat) bounds the same.
export const MAX_FEED_IDS = 200;

function validateIds(input: unknown): string[] {
	if (!Array.isArray(input) || input.some((id) => typeof id !== "string")) {
		throw new Error("Expected an array of feed ids.");
	}
	return (input as string[]).slice(0, MAX_FEED_IDS);
}

function validateId(input: unknown): string {
	if (typeof input !== "string" || input.trim() === "") {
		throw new Error("A story id is required.");
	}
	return input.trim();
}

/** A feed-card open, optionally tagged with the tab's browse session. */
function validateStoryOpen(input: unknown): {
	storyId: string;
	browseSession?: string;
} {
	const data = input as { storyId?: unknown; browseSession?: unknown };
	const storyId = typeof data?.storyId === "string" ? data.storyId.trim() : "";
	if (storyId === "") throw new Error("A story id is required.");
	const browseSession =
		typeof data?.browseSession === "string" && data.browseSession.trim() !== ""
			? data.browseSession.trim()
			: undefined;
	return { storyId, browseSession };
}

/**
 * A save to the reading list, optionally tagged with the tab's browse session
 * and the visitor's durable client id (both ride along as scoring sessions).
 */
function validateStorySave(input: unknown): {
	storyId: string;
	browseSession?: string;
	clientId?: string;
} {
	const data = input as {
		storyId?: unknown;
		browseSession?: unknown;
		clientId?: unknown;
	};
	const storyId = typeof data?.storyId === "string" ? data.storyId.trim() : "";
	if (storyId === "") throw new Error("A story id is required.");
	const browseSession =
		typeof data?.browseSession === "string" && data.browseSession.trim() !== ""
			? data.browseSession.trim()
			: undefined;
	const clientId =
		typeof data?.clientId === "string" && data.clientId.trim() !== ""
			? data.clientId.trim()
			: undefined;
	return { storyId, browseSession, clientId };
}

const RATINGS = ["good", "oversold", "spoiled"] as const;
type Rating = (typeof RATINGS)[number];

function validateRating(input: unknown): {
	storyId: string;
	rating: Rating;
	browseSession?: string;
} {
	const data = input as {
		storyId?: unknown;
		rating?: unknown;
		browseSession?: unknown;
	};
	const storyId = typeof data?.storyId === "string" ? data.storyId.trim() : "";
	if (storyId === "") throw new Error("A story id is required.");
	if (!RATINGS.includes(data?.rating as Rating)) {
		throw new Error("Expected a rating of good, oversold, or spoiled.");
	}
	const browseSession =
		typeof data?.browseSession === "string" && data.browseSession.trim() !== ""
			? data.browseSession.trim()
			: undefined;
	return { storyId, rating: data.rating as Rating, browseSession };
}

/** A story plus the feed it belongs to — the payload for a story detail page. */
export type StoryDetail = { story: Story; feed: Feed | null };

/** Add (or refresh) a feed by URL and store its stories. Friendly on failure.
 *  Following it — the server-side subscription + promotion to active — is owned
 *  by the subscriptions hook, which calls subscribeFeed right after this
 *  resolves; ingest here just makes sure the feed and its stories exist. */
export const addFeed = createServerFn({ method: "POST" })
	.validator(validateUrl)
	.handler(async ({ data: url }): Promise<AddFeedResult> => {
		try {
			const { feed, newStoryIds } = await ingestFeed(url);
			// Kick off a summary per new story. Best-effort: if Inngest is
			// unreachable, the feed was still added — don't fail the request.
			await queueStorySummaries(newStoryIds).catch(() => {});
			return { ok: true, feed };
		} catch (err) {
			const message =
				err instanceof FeedError
					? err.message
					: "Something went wrong adding that feed.";
			return { ok: false, error: message };
		}
	});

/** The whole browsable feed catalog (the browse dialog's data source). */
export const getCatalog = createServerFn({ method: "GET" }).handler(
	async (): Promise<CatalogFeed[]> => getCatalogRows(),
);

/**
 * Follow a feed: records the subscription, promotes the feed into the refresh
 * rotation, and kicks off an initial ingest when the feed has no stories yet.
 * Best-effort on the refresh send. `ok` is false only when the feed is unknown.
 */
export const subscribeFeed = createServerFn({ method: "POST" })
	.validator(validateSubscription)
	.handler(async ({ data }): Promise<{ ok: boolean }> => {
		const result = await subscribeFeedDb(data.clientId, data.feedId);
		if (result?.needsIngest) {
			await requestFeedRefresh(result.feedUrl).catch(() => {});
		}
		return { ok: result != null };
	});

/** Unfollow a feed; demotes it to dormant if that was its last subscriber. */
export const unsubscribeFeed = createServerFn({ method: "POST" })
	.validator(validateSubscription)
	.handler(async ({ data }): Promise<{ ok: true }> => {
		await unsubscribeFeedDb(data.clientId, data.feedId);
		return { ok: true };
	});

/**
 * The outcome of submitting a feed url to the catalog: either it was cataloged
 * (or was already there), or it couldn't be read. `already` distinguishes a
 * brand-new catalog entry from one that already existed.
 */
export type SubmitFeedResult =
	| { ok: true; already: boolean; title: string; category?: string | null }
	| { ok: false; error: string };

/**
 * Submit a feed url to the catalog WITHOUT subscribing or fetching its stories:
 * validate it's https, dedupe against the catalog, fetch+parse just enough to
 * confirm it's readable, classify it into a category, and store it as
 * 'cataloged'. Following it later (via subscribe) is what triggers the ingest.
 */
export const submitFeed = createServerFn({ method: "POST" })
	.validator(validateUrl)
	.handler(async ({ data: url }): Promise<SubmitFeedResult> => {
		const feedUrl = normalizeUrl(url);
		if (!/^https:\/\//i.test(feedUrl)) {
			return { ok: false, error: "Feeds must be served over https." };
		}
		const id = hashId(feedUrl);
		const existing = await getFeedById(id);
		if (existing) {
			return { ok: true, already: true, title: existing.title };
		}
		try {
			const parsed = await fetchAndParseFeed(feedUrl);
			if (parsed.items.length === 0) {
				return { ok: false, error: "That feed has no readable entries." };
			}
			const category = await classifyCategory({
				title: parsed.title,
				description: parsed.description,
				itemTitles: parsed.items.slice(0, 8).map((i) => i.title),
			}).catch(() => null);
			const iconUrl = faviconUrl(parsed.siteUrl, feedUrl);
			await insertCatalogedFeed({
				id,
				feedUrl,
				title: parsed.title,
				siteUrl: parsed.siteUrl,
				description: parsed.description,
				category,
				iconUrl,
			});
			return { ok: true, already: false, title: parsed.title, category };
		} catch (err) {
			const error =
				err instanceof FeedError ? err.message : "Could not read that feed.";
			return { ok: false, error };
		}
	});

/** Hydrate the feed records a visitor is subscribed to (order preserved). */
export const getFeeds = createServerFn({ method: "POST" })
	.validator(validateIds)
	.handler(async ({ data: ids }): Promise<Feed[]> => getFeedsByIds(ids));

/** The story cards for a visitor's subscribed feeds, newest first. */
export const getStories = createServerFn({ method: "POST" })
	.validator(validateIds)
	.handler(async ({ data: ids }): Promise<Story[]> => getStoriesByFeedIds(ids));

/** A single story plus its feed, for the per-story page. Null if unknown. */
export const getStory = createServerFn({ method: "POST" })
	.validator(validateId)
	.handler(async ({ data: id }): Promise<StoryDetail | null> => {
		const story = await getStoryById(id);
		if (!story) return null;
		const [feed] = await getFeedsByIds([story.feedId]);
		return { story, feed: feed ?? null };
	});

/**
 * Record a feed-card open as a durable click signal (`from: "feed"`), so feed
 * engagement is scoreable alongside chat and story-detail clicks. Opening a card
 * navigates in-app rather than out to the source, so — unlike chat/story links —
 * it can't ride the /r/ redirect; this server fn is the feed's equivalent hook.
 * Best-effort: a tracking hiccup must never block the reader's navigation.
 */
export const recordStoryOpen = createServerFn({ method: "POST" })
	.validator(validateStoryOpen)
	.handler(async ({ data }): Promise<{ ok: boolean }> => {
		const story = await getStoryById(data.storyId);
		if (!story) return { ok: false };
		await recordStoryClick(
			{
				storyId: story.id,
				feedId: story.feedId,
				url: story.url,
				from: "feed",
				action: "open",
			},
			{ browseSession: data.browseSession },
		).catch(() => {});
		return { ok: true };
	});

/**
 * Record a save to the reading list as a durable engagement signal. Saving is a
 * strong positive signal (a deliberate "come back to this"), so it fires the
 * same kind of best-effort durable Inngest event the click/rating paths do.
 * Best-effort: a tracking hiccup must never block the reader's save.
 */
export const recordStorySave = createServerFn({ method: "POST" })
	.validator(validateStorySave)
	.handler(async ({ data }): Promise<{ ok: boolean }> => {
		const story = await getStoryById(data.storyId);
		if (!story) return { ok: false };
		await emitStorySave(story.id, {
			browseSession: data.browseSession,
			clientId: data.clientId,
		}).catch(() => {});
		return { ok: true };
	});

/** Hydrate the saved story cards a visitor's reading list points at. */
export const getSavedStories = createServerFn({ method: "POST" })
	.validator(validateIds)
	.handler(async ({ data: ids }): Promise<Story[]> => getStoriesByIds(ids));

/**
 * Record a reader's rating of a story's summary. Fires the durable signal that
 * `score-rating` turns into a per-variant `satisfaction` score and persists on
 * the story row. Best-effort: a tracking hiccup must never block the reader.
 */
export const rateSummary = createServerFn({ method: "POST" })
	.validator(validateRating)
	.handler(async ({ data }): Promise<{ ok: boolean }> => {
		await recordSummaryRating(
			data.storyId,
			data.rating,
			data.browseSession,
		).catch(() => {});
		return { ok: true };
	});

/**
 * Trigger a fresh summary for one story. Best-effort: if Inngest is
 * unreachable the request still resolves so the UI can report cleanly.
 */
export const resummarizeStory = createServerFn({ method: "POST" })
	.validator(validateId)
	.handler(async ({ data: id }): Promise<{ ok: boolean }> => {
		await requestResummarize(id).catch(() => {});
		return { ok: true };
	});

// --- Shared lists ----------------------------------------------------------

// Caps on the publishable payload, so a tampered client can't store an unbounded
// title or folder tree. The id count rides the same MAX_FEED_IDS bound as the
// rest of the feed endpoints.
const MAX_LIST_TITLE = 80;
const MAX_LIST_STRUCTURE = 20000;
const LIST_KINDS = ["feeds", "stories"] as const;

type CreateListInput = {
	kind: SharedListKind;
	title: string | null;
	ids: string[];
	clientId: string | null;
	structure: string | null;
};

function validateCreateList(input: unknown): CreateListInput {
	const data = input as {
		kind?: unknown;
		title?: unknown;
		ids?: unknown;
		clientId?: unknown;
		structure?: unknown;
	};
	if (!LIST_KINDS.includes(data?.kind as SharedListKind)) {
		throw new Error("Expected a list kind of feeds or stories.");
	}
	const ids = validateIds(data?.ids);
	if (ids.length === 0) throw new Error("A list needs at least one item.");

	const title =
		typeof data?.title === "string" && data.title.trim() !== ""
			? data.title.trim().slice(0, MAX_LIST_TITLE)
			: null;

	const clientId =
		typeof data?.clientId === "string" && data.clientId.trim() !== ""
			? data.clientId.trim()
			: null;

	let structure: string | null = null;
	if (data?.structure != null) {
		if (typeof data.structure !== "string") {
			throw new Error("List structure must be a JSON string.");
		}
		if (data.structure.length > MAX_LIST_STRUCTURE) {
			throw new Error("List structure is too large.");
		}
		structure = data.structure;
	}

	return { kind: data.kind as SharedListKind, title, ids, clientId, structure };
}

/**
 * The metadata + hydrated items a /l/<slug> preview renders. A discriminated
 * union on `kind`, so narrowing on `list.kind` also narrows `items` — no casts
 * needed at the call site.
 */
export type ListResult =
	| {
			kind: "feeds";
			title: string | null;
			structure: string | null;
			items: Feed[];
	  }
	| {
			kind: "stories";
			title: string | null;
			structure: string | null;
			items: Story[];
	  };

/** Publish the visitor's current selection as a shared list; returns its slug. */
export const createList = createServerFn({ method: "POST" })
	.validator(validateCreateList)
	.handler(async ({ data }): Promise<{ slug: string }> => {
		const slug = await createSharedList({
			kind: data.kind,
			title: data.title,
			ownerClientId: data.clientId,
			itemIds: data.ids,
			structure: data.structure,
		});
		return { slug };
	});

/** Hydrate a shared list for its preview page. Null if the slug is unknown. */
export const getList = createServerFn({ method: "POST" })
	.validator(validateId)
	.handler(async ({ data: slug }): Promise<ListResult | null> => {
		const list = await getSharedList(slug);
		if (!list) return null;
		if (list.kind === "stories") {
			const items = await getStoriesByIds(list.itemIds);
			return {
				kind: "stories",
				title: list.title,
				structure: list.structure,
				items,
			};
		}
		const items = await getFeedsByIds(list.itemIds);
		return {
			kind: "feeds",
			title: list.title,
			structure: list.structure,
			items,
		};
	});
