import { createServerFn } from "@tanstack/react-start";
import {
	queueStorySummaries,
	recordStoryClick,
	recordSummaryRating,
	requestResummarize,
} from "#/inngest/events";
import { FeedError } from "#/lib/rss";
import type { Feed, Story } from "#/lib/types";
import {
	getFeedsByIds,
	getStoriesByFeedIds,
	getStoryById,
	ingestFeed,
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

/** Add (or refresh) a feed by URL and store its stories. Friendly on failure. */
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
			},
			{ browseSession: data.browseSession },
		).catch(() => {});
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
 * Trigger a fresh summary for one story. Best-effort: if Inngest is
 * unreachable the request still resolves so the UI can report cleanly.
 */
export const resummarizeStory = createServerFn({ method: "POST" })
	.validator(validateId)
	.handler(async ({ data: id }): Promise<{ ok: boolean }> => {
		await requestResummarize(id).catch(() => {});
		return { ok: true };
	});
