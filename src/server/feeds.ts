import { createServerFn } from "@tanstack/react-start";
import { queueStorySummaries, requestResummarize } from "#/inngest/events";
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

function validateIds(input: unknown): string[] {
	if (!Array.isArray(input) || input.some((id) => typeof id !== "string")) {
		throw new Error("Expected an array of feed ids.");
	}
	// Cap the fan-out so a tampered client can't ask for thousands at once.
	return (input as string[]).slice(0, 200);
}

function validateId(input: unknown): string {
	if (typeof input !== "string" || input.trim() === "") {
		throw new Error("A story id is required.");
	}
	return input.trim();
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
 * Trigger a fresh summary for one story. Best-effort: if Inngest is
 * unreachable the request still resolves so the UI can report cleanly.
 */
export const resummarizeStory = createServerFn({ method: "POST" })
	.validator(validateId)
	.handler(async ({ data: id }): Promise<{ ok: boolean }> => {
		await requestResummarize(id).catch(() => {});
		return { ok: true };
	});
