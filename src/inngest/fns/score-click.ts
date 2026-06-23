import { getStoryById, recordClick } from "#/server/db";
import { inngest } from "../client";
import { storyClicked } from "../events";

/**
 * Durably records that a reader clicked through to a story — a fresh,
 * event-driven run per click, retried on failure. Stamping `last_clicked_at`
 * anchors the click within the reader's browse/conversation session; the bump
 * also feeds engagement scoring.
 *
 * The count is emitted as a per-variant experiment score — a magnitude (avg per
 * run on the summary-strategy dashboard) — split by what the reader did:
 * `opens` (viewed the in-app show page, weak) vs `clickthroughs` (clicked out to
 * the original article, the strong teaser signal). Like the rating path this is
 * a parentless run, so attribution flows through the summarize run id persisted
 * on the story (`runId`) plus its served variant. The increment is memoized in a
 * step so a retry can't double-count.
 */
export const scoreClick = inngest.createFunction(
	{ id: "score-click", triggers: [storyClicked] },
	async ({ event, step }) => {
		const { storyId, action } = event.data;

		const count = await step.run("record-click", () =>
			recordClick(storyId, Date.now(), action),
		);
		const story = await step.run("load-story", () => getStoryById(storyId));

		// No variant to credit (or no summarize run to attribute to): record the
		// click but skip scoring. Mirrors the rating path's guard.
		if (story?.servedVariant && story.experimentName && story.summarizeRunId) {
			await inngest.score.experiment({
				name: action === "open" ? "opens" : "clickthroughs",
				value: count,
				experiment: {
					experimentName: story.experimentName,
					variant: story.servedVariant,
				},
				runId: story.summarizeRunId,
			});
		}

		return { storyId, action, count };
	},
);
