import { inngest } from "../client";
import { storySaved } from "../events";

/**
 * The scoring hook for a save — a strong positive engagement signal. Unlike a
 * click, there's no db column to stamp: the run itself is the durable, retriable
 * record that this story was saved, a fresh event-driven run per save.
 *
 * Like the click path, it doesn't (yet) emit a per-variant experiment score —
 * saving isn't modelled as a per-variant score here. The run stands as the
 * signal.
 */
export const scoreSave = inngest.createFunction(
	{ id: "score-save", triggers: [storySaved] },
	async ({ event }) => {
		const storyId = event.data.storyId;
		return { storyId };
	},
);
