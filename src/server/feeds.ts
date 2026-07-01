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
import { authMiddleware, requireUser } from "./auth";
import { classifyCategory } from "./categorize";
import {
	createSharedList,
	getCatalog as getCatalogRows,
	getFeedById,
	getFeedsByIds,
	getPopularStories as getPopularStoriesDb,
	getSharedList,
	getStoriesByFeedIds,
	getStoriesByIds,
	getStoryById,
	getUserSavedStories,
	getUserSubscriptions,
	type ImportSavedStory,
	type ImportSubscription,
	importLocalState as importLocalStateDb,
	ingestFeed,
	insertCatalogedFeed,
	isStorySaved,
	type SharedListKind,
	saveUserStory,
	setUserStoryCollections,
	subscribeFeed as subscribeFeedDb,
	unsaveUserStory,
	unsubscribeFeed as unsubscribeFeedDb,
} from "./db";

/**
 * Server functions are the client's whole API surface. They run in the Worker,
 * so they're the only place D1 is touched. Subscriptions and saved stories are
 * now per-user rows (see #/server/db.ts), gated by authMiddleware; only a
 * signed-in reader's own data is ever readable or writable through these.
 */

type AddFeedResult = { ok: true; feed: Feed } | { ok: false; error: string };

function validateUrl(input: unknown): string {
	if (typeof input !== "string" || input.trim() === "") {
		throw new Error("A feed URL is required.");
	}
	return input.trim();
}

/** A feed id, for the unsubscribe endpoint. The user comes from the session, not the client. */
function validateFeedId(input: unknown): { feedId: string } {
	const data = input as { feedId?: unknown };
	const feedId = typeof data?.feedId === "string" ? data.feedId.trim() : "";
	if (feedId === "") throw new Error("A feed id is required.");
	return { feedId };
}

/** A feed id + flavor, for the subscribe endpoint (flavor is the cosmetic color
 *  the client picked for this feed in its sidebar). */
function validateSubscription(input: unknown): {
	feedId: string;
	flavor: string;
} {
	const data = input as { feedId?: unknown; flavor?: unknown };
	const feedId = typeof data?.feedId === "string" ? data.feedId.trim() : "";
	if (feedId === "") throw new Error("A feed id is required.");
	const flavor = typeof data?.flavor === "string" ? data.flavor.trim() : "";
	if (flavor === "") throw new Error("A flavor is required.");
	return { feedId, flavor };
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

/** A save to the reading list, optionally tagged with the tab's browse session
 *  (rides along as a scoring session). The saver's identity comes from the
 *  authenticated session, not the client. */
function validateStorySave(input: unknown): {
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
export type StoryDetail = {
	story: Story;
	feed: Feed | null;
	isSaved: boolean;
};

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
	.middleware([authMiddleware])
	.validator(validateSubscription)
	.handler(async ({ data, context }): Promise<{ ok: boolean }> => {
		const user = requireUser(context);
		const result = await subscribeFeedDb(user.id, data.feedId, data.flavor);
		if (result?.needsIngest) {
			await requestFeedRefresh(result.feedUrl).catch(() => {});
		}
		return { ok: result != null };
	});

/** Unfollow a feed; demotes it to dormant if that was its last subscriber. */
export const unsubscribeFeed = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.validator(validateFeedId)
	.handler(async ({ data, context }): Promise<{ ok: true }> => {
		const user = requireUser(context);
		await unsubscribeFeedDb(user.id, data.feedId);
		return { ok: true };
	});

/** The signed-in reader's subscriptions (feed id + flavor), for hydrating their
 *  own feed list — the account-backed successor to reading useSubscriptions'
 *  localStorage array. */
export const getMySubscriptions = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(
		async ({ context }): Promise<{ feedId: string; flavor: string }[]> => {
			const user = requireUser(context);
			return getUserSubscriptions(user.id);
		},
	);

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

/** The catalog's most-engaged stories — the signed-out home feed's data source,
 *  so a reader sees something worth reading before they follow a single flavor. */
export const getPopularStories = createServerFn({ method: "GET" }).handler(
	async (): Promise<Story[]> => getPopularStoriesDb(),
);

/** A single story plus its feed, for the per-story page. Null if unknown.
 *  Also reports whether the *signed-in* caller has it saved, so the story
 *  page's save button reflects reality on load instead of always starting
 *  unsaved — anonymous callers just get `isSaved: false`. */
export const getStory = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.validator(validateId)
	.handler(async ({ data: id, context }): Promise<StoryDetail | null> => {
		const story = await getStoryById(id);
		if (!story) return null;
		const [feed] = await getFeedsByIds([story.feedId]);
		const isSaved = context.user
			? await isStorySaved(context.user.id, id)
			: false;
		return { story, feed: feed ?? null, isSaved };
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
 * Save a story to the signed-in reader's reading list, and fire the same kind
 * of best-effort durable Inngest event the click/rating paths do (saving is a
 * strong positive signal — a deliberate "come back to this"). The `clientId`
 * the emitted event carries is the reader's durable user id now, the same
 * session-stitching role the old anonymous client id played.
 */
export const recordStorySave = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.validator(validateStorySave)
	.handler(async ({ data, context }): Promise<{ ok: boolean }> => {
		const user = requireUser(context);
		const story = await getStoryById(data.storyId);
		if (!story) return { ok: false };
		await saveUserStory(user.id, story.id, []);
		await emitStorySave(story.id, {
			browseSession: data.browseSession,
			clientId: user.id,
		}).catch(() => {});
		return { ok: true };
	});

/** Remove a story from the signed-in reader's reading list. */
export const removeStorySave = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.validator(validateId)
	.handler(async ({ data: storyId, context }): Promise<{ ok: boolean }> => {
		const user = requireUser(context);
		await unsaveUserStory(user.id, storyId);
		return { ok: true };
	});

// The collections array rides the same defensive cap as everything else that
// bounds a client-supplied array (MAX_FEED_IDS, MAX_IMPORT_ITEMS).
const MAX_COLLECTIONS_PER_STORY = 200;

function validateUpdateCollections(input: unknown): {
	storyId: string;
	collections: string[];
} {
	const data = input as { storyId?: unknown; collections?: unknown };
	const storyId = typeof data?.storyId === "string" ? data.storyId.trim() : "";
	if (storyId === "") throw new Error("A story id is required.");
	if (
		!Array.isArray(data?.collections) ||
		data.collections.some((c) => typeof c !== "string")
	) {
		throw new Error("Expected an array of collection ids.");
	}
	return {
		storyId,
		collections: (data.collections as string[]).slice(
			0,
			MAX_COLLECTIONS_PER_STORY,
		),
	};
}

/**
 * Set a saved story's collection membership wholesale — the server-backed
 * successor to useSaved's local setStoryCollections/addToCollection/
 * removeFromCollection. Calls setUserStoryCollections directly (a plain
 * UPDATE), so the caller (the /saved page) always sends the full membership
 * array, not a delta. The story must already be saved for this to have
 * signal; we don't re-save it here, so a collections update against an
 * unsaved story is a silent no-op (there's no row to update).
 */
export const updateSavedCollections = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.validator(validateUpdateCollections)
	.handler(async ({ data, context }): Promise<{ ok: boolean }> => {
		const user = requireUser(context);
		const saved = await getUserSavedStories(user.id);
		if (!saved.some((s) => s.storyId === data.storyId)) return { ok: false };
		await setUserStoryCollections(user.id, data.storyId, data.collections);
		return { ok: true };
	});

/** Hydrate the signed-in reader's saved story cards, newest save first. */
export const getSavedStories = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<Story[]> => {
		const user = requireUser(context);
		const saved = await getUserSavedStories(user.id);
		return getStoriesByIds(saved.map((s) => s.storyId));
	});

/**
 * The signed-in reader's saved-story rows verbatim (id, when, and which
 * collections it's tagged into), newest save first. `getSavedStories` hydrates
 * the Story cards; /saved's collection UI (folders/tags/filtering) needs this
 * raw membership data too, which the hydrated Story shape doesn't carry.
 */
export const getMySavedEntries = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(
		async ({
			context,
		}): Promise<
			{ storyId: string; savedAt: number; collections: string[] }[]
		> => {
			const user = requireUser(context);
			return getUserSavedStories(user.id);
		},
	);

// A tampered client shouldn't be able to import an unbounded pile of rows in
// one shot, so this rides the same defensive-cap pattern as MAX_FEED_IDS/MAX_TURNS.
const MAX_IMPORT_ITEMS = 500;

function validateImportLocalState(input: unknown): {
	subscriptions: ImportSubscription[];
	saved: ImportSavedStory[];
} {
	const data = input as {
		subscriptions?: unknown;
		saved?: unknown;
	};
	const subscriptions = Array.isArray(data?.subscriptions)
		? data.subscriptions
				.filter(
					(s): s is ImportSubscription =>
						s != null &&
						typeof s.id === "string" &&
						typeof s.flavor === "string",
				)
				.slice(0, MAX_IMPORT_ITEMS)
		: [];
	const saved = Array.isArray(data?.saved)
		? data.saved
				.filter(
					(s): s is ImportSavedStory =>
						s != null &&
						typeof s.storyId === "string" &&
						typeof s.savedAt === "number" &&
						Array.isArray(s.collections) &&
						s.collections.every((c: unknown) => typeof c === "string"),
				)
				.slice(0, MAX_IMPORT_ITEMS)
		: [];
	return { subscriptions, saved };
}

/**
 * One-time merge of a browser's pre-login localStorage state into the
 * newly-signed-in reader's server-side rows. Called once by the client right
 * after voodoo hands back a session; idempotent, so a retry or double-call is
 * harmless.
 */
export const importLocalState = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.validator(validateImportLocalState)
	.handler(async ({ data, context }): Promise<{ ok: true }> => {
		const user = requireUser(context);
		await importLocalStateDb(user.id, data.subscriptions, data.saved);
		return { ok: true };
	});

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
 * Trigger a fresh summary for one story. Admin-only: the "Resummarize" button
 * used to be gated only by a client-side localStorage flag (trivially
 * bypassable), so now that real identity exists this is enforced server-side.
 * Best-effort on the send: if Inngest is unreachable the request still
 * resolves so the UI can report cleanly.
 */
export const resummarizeStory = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.validator(validateId)
	.handler(async ({ data: id, context }): Promise<{ ok: boolean }> => {
		if (!context.user?.isAdmin) throw new Error("Admin access required.");
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
	structure: string | null;
};

function validateCreateList(input: unknown): CreateListInput {
	const data = input as {
		kind?: unknown;
		title?: unknown;
		ids?: unknown;
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

	return { kind: data.kind as SharedListKind, title, ids, structure };
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
	.middleware([authMiddleware])
	.validator(validateCreateList)
	.handler(async ({ data, context }): Promise<{ slug: string }> => {
		const user = requireUser(context);
		const slug = await createSharedList({
			kind: data.kind,
			title: data.title,
			ownerClientId: user.id,
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
