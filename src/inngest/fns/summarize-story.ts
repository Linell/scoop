import { getStoryById, saveSummary } from "#/server/db";
import { enrichStory } from "#/server/extract";
import { summarizeStory as generateSummary } from "#/server/summarize";
import { inngest } from "../client";
import { STORY_CREATED } from "../events";

/**
 * Summarizes a single story. One of these runs per new story (fanned out from
 * `scoop/story.created`), so each summary retries and scales on its own.
 *
 * This is the seam for scoring: once the summary is written, the next phase will
 * run an LLM-as-judge score on it right here, between the model call and the save.
 */
export const summarizeStory = inngest.createFunction(
	{
		id: "summarize-story",
		// One model call per run; cap the fan-out so a big refresh can't stampede
		// the API (and our rate limits).
		concurrency: { limit: 5 },
		triggers: [{ event: STORY_CREATED }],
	},
	async ({ event, step }) => {
		const storyId = event.data.storyId as string;

		const story = await step.run("load-story", () => getStoryById(storyId));
		if (!story) return { storyId, skipped: "not-found" };
		// Summaries are shared and immutable; never pay to redo one.
		if (story.summary) return { storyId, skipped: "already-summarized" };
		// We now fetch the article page, so a story with an empty feed blurb but a
		// real URL is still summarizable. Only skip true title-only items: no feed
		// content AND no URL to fetch means there's nothing to summarize beyond the
		// title the reader already sees.
		if (!story.content?.trim() && !story.url?.trim())
			return { storyId, skipped: "no-content" };

		// Best-effort enrichment: fetch the real article (and HN discussion) so the
		// summary reflects the actual story, not just the feed teaser. Its own step
		// so it's durable + visible in the dev dashboard; it never throws, so a
		// failed fetch just yields empty text and summarization proceeds anyway.
		const enriched = await step.run("fetch-content", () => enrichStory(story));

		const summary = await step.run("summarize", () =>
			generateSummary(story, enriched),
		);
		await step.run("save-summary", () => saveSummary(storyId, summary));

		return { storyId, summary };
	},
);
