import { getStoryById, saveRating } from "#/server/db";
import { inngest } from "../client";
import { summaryRated } from "../events";

/**
 * Maps a reader's rating to a per-variant `satisfaction` score — a human signal
 * alongside the automated judge and clickthrough scores. We persist the rating
 * first (so the card can reflect it regardless of attribution), then credit the
 * teaser-strategy variant that produced the summary.
 *
 * Like the click path, a rating is a fresh, event-driven run that never joined
 * the original `summarize-story` experiment run. Attribution flows purely
 * through the `experiment` ref (name + variant), called at the function-body
 * level so the write is run-scoped — no original run id needed.
 */
const SATISFACTION: Record<"good" | "oversold" | "spoiled", number> = {
	good: 1,
	oversold: 0.3,
	spoiled: 0,
};

export const scoreRating = inngest.createFunction(
	{ id: "score-rating", triggers: [summaryRated] },
	async ({ event }) => {
		const { storyId, rating } = event.data;

		// Persist the human's choice first; it stands on its own even if there's
		// no variant to credit.
		await saveRating(storyId, rating, Date.now());

		const story = await getStoryById(storyId);

		// No story, or a summary written before the experiment existed: there's no
		// variant to credit, so the rating can't be attributed. No-op cleanly.
		if (!story?.servedVariant || !story.experimentName) {
			return { storyId, rating, skipped: "no-variant" };
		}

		await inngest.score.experiment({
			name: "satisfaction",
			value: SATISFACTION[rating],
			experiment: {
				experimentName: story.experimentName,
				variant: story.servedVariant,
			},
		});

		return { storyId, rating, variant: story.servedVariant };
	},
);
