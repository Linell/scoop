import { getAllFeedUrls, ingestFeed } from "#/server/db";
import { inngest } from "../client";
import { STORY_CREATED } from "../events";

/**
 * Keeps the shared catalog fresh. Runs on a cron, fans out one step per feed so
 * a single slow/broken feed can't sink the batch, re-ingests each one, then
 * fans out a summary job per newly-ingested story.
 */
export const refreshFeeds = inngest.createFunction(
	{ id: "refresh-feeds", triggers: [{ cron: "*/30 * * * *" }] },
	async ({ step }) => {
		const urls = await step.run("list-feeds", () => getAllFeedUrls());

		const results = await Promise.all(
			urls.map((url) =>
				step
					.run(`refresh:${url}`, () => ingestFeed(url))
					.then((r) => ({ url, ok: true, newStoryIds: r.newStoryIds }))
					.catch(() => ({ url, ok: false, newStoryIds: [] as string[] })),
			),
		);

		const newStoryIds = results.flatMap((r) => r.newStoryIds);
		if (newStoryIds.length > 0) {
			await step.sendEvent(
				"queue-summaries",
				newStoryIds.map((storyId) => ({
					name: STORY_CREATED,
					data: { storyId },
				})),
			);
		}

		return {
			feeds: urls.length,
			refreshed: results.filter((r) => r.ok).length,
			queued: newStoryIds.length,
		};
	},
);
