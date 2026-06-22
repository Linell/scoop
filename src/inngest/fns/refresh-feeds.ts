import { getAllFeedUrls } from "#/server/db";
import { inngest } from "../client";
import { feedRefreshRequested } from "../events";

/**
 * Keeps the shared catalog fresh. Runs on a cron and acts as a thin
 * orchestrator: it lists every feed and emits one `scoop/feed.refresh.requested`
 * event per url, then gets out of the way. The actual ingest happens in the
 * `refresh-feed` function — one run per feed — mirroring the per-story fan-out,
 * so a single slow/broken feed retries on its own and never sinks the batch.
 */
export const refreshFeeds = inngest.createFunction(
	{ id: "refresh-feeds", triggers: [{ cron: "*/30 * * * *" }] },
	async ({ step }) => {
		const urls = await step.run("list-feeds", () => getAllFeedUrls());
		if (urls.length > 0) {
			await step.sendEvent(
				"request-feed-refreshes",
				urls.map((feedUrl) => feedRefreshRequested.create({ feedUrl })),
			);
		}
		return { feeds: urls.length };
	},
);
