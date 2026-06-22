import { eventType } from "inngest";
import { z } from "zod";
import { inngest } from "./client";

/**
 * Fired once per newly-ingested story. Each event fans out into its own
 * `summarize-story` run, so a slow/failing summary for one story never blocks
 * the others — and later, each run is a natural unit to attach a score to.
 */
export const storyCreated = eventType("scoop/story.created", {
	schema: z.object({ storyId: z.string() }),
});

/** A human asked to regenerate a story's summary; handled by `resummarize-story`. */
export const storyResummarizeRequested = eventType(
	"scoop/story.resummarize.requested",
	{ schema: z.object({ storyId: z.string() }) },
);

/**
 * Regenerate this story's summary now. A dedicated event (rather than re-firing
 * `scoop/story.created`) so the log keeps "created" meaning created.
 */
export const storyResummarize = eventType("scoop/story.resummarize", {
	schema: z.object({ storyId: z.string() }),
});

/**
 * Fired once per feed by the `refresh-feeds` cron. Each event fans out into its
 * own `refresh-feed` run, so a single slow/broken feed retries and scales on
 * its own without blocking the rest of the batch.
 */
export const feedRefreshRequested = eventType("scoop/feed.refresh.requested", {
	schema: z.object({ feedUrl: z.string() }),
});

/** Best-effort: enqueue a summary job for each new story id. */
export async function queueStorySummaries(storyIds: string[]): Promise<void> {
	if (storyIds.length === 0) return;
	await inngest.send(
		storyIds.map((storyId) => storyCreated.create({ storyId })),
	);
}

/** Ask Scoop to regenerate one story's summary. */
export async function requestResummarize(storyId: string): Promise<void> {
	await inngest.send(storyResummarizeRequested.create({ storyId }));
}
