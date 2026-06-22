import { ingestFeed } from "#/server/db";
import { inngest } from "../client";
import { feedRefreshRequested, storyCreated } from "../events";

/**
 * Ingests a single feed and fans out a summary job per newly-ingested story.
 * One of these runs per feed, triggered by the `scoop/feed.refresh.requested`
 * events that the `refresh-feeds` cron emits — the cron is just the orchestrator
 * that lists feeds, this is where each feed is handled durably with its own
 * retries. Splitting them this way means a slow or broken feed only fails (and
 * retries) its own run, and never blocks the others in the batch.
 */
export const refreshFeed = inngest.createFunction(
	{
		id: "refresh-feed",
		// One feed per run: a slow or broken feed retries on its own and never
		// blocks the others. Singleton-skip keeps the cron from stacking two
		// ingests of the same feed when a refresh runs long.
		concurrency: { limit: 5 },
		singleton: { key: "event.data.feedUrl", mode: "skip" },
		triggers: [feedRefreshRequested],
	},
	async ({ event, step }) => {
		const { feedUrl } = event.data;
		const { newStoryIds } = await step.run("ingest", () => ingestFeed(feedUrl));
		if (newStoryIds.length > 0) {
			await step.sendEvent(
				"queue-summaries",
				newStoryIds.map((storyId) => storyCreated.create({ storyId })),
			);
		}
		return { feedUrl, queued: newStoryIds.length };
	},
);
