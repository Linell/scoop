import { getStoryById, recordSave } from "#/server/db";
import { inngest } from "../client";
import { storySaved } from "../events";

/**
 * The scoring hook for a save — a strong positive engagement signal, a fresh
 * event-driven run per save. Bumps the story's save counter and emits the total
 * as a per-variant `saves` experiment score: a magnitude (avg saves per run on
 * the summary-strategy dashboard).
 *
 * Like the rating/click paths, this is a parentless run, so attribution flows
 * through the summarize run id persisted on the story (`runId`) plus its served
 * variant. The increment is memoized in a step so a retry can't double-count.
 */
export const scoreSave = inngest.createFunction(
	{ id: "score-save", triggers: [storySaved] },
	async ({ event, step }) => {
		const storyId = event.data.storyId;

		const saveCount = await step.run("record-save", () => recordSave(storyId));
		const story = await step.run("load-story", () => getStoryById(storyId));

		// No variant to credit (or no summarize run to attribute to): the save run
		// still stands as a durable signal, but skip per-variant scoring.
		if (story?.servedVariant && story.experimentName && story.summarizeRunId) {
			await inngest.score.experiment({
				name: "saves",
				value: saveCount,
				experiment: {
					experimentName: story.experimentName,
					variant: story.servedVariant,
				},
				runId: story.summarizeRunId,
			});
		}

		return { storyId, saveCount };
	},
);
