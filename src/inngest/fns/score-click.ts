import { recordClick } from "#/server/db";
import { inngest } from "../client";
import { storyClicked } from "../events";

/**
 * Durably records that a reader clicked through to a story. Stamping
 * `last_clicked_at` anchors the click onto the story within the reader's
 * browse/conversation session — a fresh, event-driven run per click, retried on
 * failure.
 *
 * It no longer emits a `clickthrough` experiment score: clickthrough is no
 * longer modelled as a per-variant score here.
 */
export const scoreClick = inngest.createFunction(
	{ id: "score-click", triggers: [storyClicked] },
	async ({ event }) => {
		const storyId = event.data.storyId;
		await recordClick(storyId, Date.now());
		return { storyId };
	},
);
