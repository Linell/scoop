import { clearSummary, getStoryById } from "#/server/db";
import { inngest } from "../client";
import { storyCreated, storyResummarize } from "../events";

/**
 * Regenerates one story's summary on demand (e.g. an admin hits "Resummarize"
 * after we taught extraction to read a previously-blocked page).
 *
 * Rather than duplicate the summarize pipeline, we use the clear-before-emit
 * trick: null the stored summary, then re-fire `scoop/story.created`. The
 * existing `summarize-story` function sees a NULL summary, so its
 * already-summarized guard falls through and it re-runs enrichment + the model
 * exactly as it would for a brand-new story.
 */
export const resummarizeStory = inngest.createFunction(
	{ id: "resummarize-story", triggers: [storyResummarize] },
	async ({ event, step }) => {
		const storyId = event.data.storyId;

		const story = await step.run("load-story", () => getStoryById(storyId));
		if (!story) return { storyId, skipped: "not-found" };

		await step.run("clear-summary", () => clearSummary(storyId));
		await step.sendEvent("requeue-summary", storyCreated.create({ storyId }));

		return { storyId, resummarized: true };
	},
);
