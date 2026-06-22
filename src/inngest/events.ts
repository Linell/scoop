import { inngest } from "./client";

/**
 * Fired once per newly-ingested story. Each event fans out into its own
 * `summarize-story` run, so a slow/failing summary for one story never blocks
 * the others — and later, each run is a natural unit to attach a score to.
 */
export const STORY_CREATED = "scoop/story.created";

/**
 * Fired to regenerate an existing summary. The `resummarize-story` function
 * clears the stored summary and re-emits `scoop/story.created`, so a refusal or
 * a summary made before the article was readable can be replaced on demand.
 */
export const STORY_RESUMMARIZE = "scoop/story.resummarize";

/** Best-effort: enqueue a summary job for each new story id. */
export async function queueStorySummaries(storyIds: string[]): Promise<void> {
	if (storyIds.length === 0) return;
	await inngest.send(
		storyIds.map((storyId) => ({ name: STORY_CREATED, data: { storyId } })),
	);
}

/** Ask Scoop to regenerate one story's summary. */
export async function requestResummarize(storyId: string): Promise<void> {
	await inngest.send({ name: STORY_RESUMMARIZE, data: { storyId } });
}
