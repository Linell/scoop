import { clearSummary, getStoryById } from "#/server/db";
import { inngest } from "../client";
import { storyResummarize, storyResummarizeRequested } from "../events";

/**
 * Null the stored summary, then hand off to `summarize-story` via
 * `scoop/story.resummarize` — its already-summarized guard now falls through and
 * the regeneration reuses the normal pipeline.
 */
export const resummarizeStory = inngest.createFunction(
	{ id: "resummarize-story", triggers: [storyResummarizeRequested] },
	async ({ event, step }) => {
		const storyId = event.data.storyId;

		const story = await step.run("load-story", () => getStoryById(storyId));
		if (!story) return { storyId, skipped: "not-found" };

		await step.run("clear-summary", () => clearSummary(storyId));
		await step.sendEvent(
			"requeue-summary",
			storyResummarize.create({ storyId }),
		);

		return { storyId, resummarized: true };
	},
);
