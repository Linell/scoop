import { experiment } from "inngest";
import { getStoryById, saveSummary } from "#/server/db";
import { enrichStory } from "#/server/extract";
import {
	lengthOk,
	noEmdash,
	notRefusal,
	sentenceCountOk,
} from "#/server/judge";
import { summarizeStory as generateSummary } from "#/server/summarize";
import { inngest } from "../client";
import { storyCreated, storyResummarize } from "../events";
import { judgeSummaryScorer } from "./judge-summary";

/**
 * Summarizes a single story — one run per `scoop/story.created`, so each summary
 * retries and scales on its own. Also handles `scoop/story.resummarize`, which
 * arrives with the summary already cleared and so flows through unchanged.
 *
 * Which summary a reader sees is an A/B experiment: `group.experiment` serves
 * one of two teaser strategies (`questionLed` / `factLed`) per story, picked by
 * a run-seeded weighted split so the choice is replay-stable. We persist the
 * served variant alongside the summary.
 *
 * The flow is: experiment-select the summary → save it → run cheap
 * deterministic guardrails inline (run-scoped via `step.score`) → defer the
 * LLM-as-judge. Scoring runs only after the save, so grading never blocks or
 * breaks the saved result. The judge is a DEFERRED SCORER (`judgeSummaryScorer`)
 * fired via `defer(...)`: it grades the summary against the article in its own
 * retryable run and attributes its three axes to the served variant through the
 * `experiment` ref we pass along.
 */
export const summarizeStory = inngest.createFunction(
	{
		id: "summarize-story",
		// One model call per run; cap the fan-out so a big refresh can't stampede
		// the API (and our rate limits).
		concurrency: { limit: 5 },
		// Singleton-skip collapses concurrent runs for the same story into one. The
		// already-summarized DB check below is a check-then-act read: two runs for
		// the same storyId could both observe a NULL summary and both pay for a
		// model call. This guarantees at most one run per story is ever in flight.
		singleton: { key: "event.data.storyId", mode: "skip" },
		triggers: [storyCreated, storyResummarize],
	},
	async ({ event, step, group, defer }) => {
		const storyId = event.data.storyId;

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

		// A/B the teaser strategy. Each variant wraps its model call in `step.run`
		// for durability — `group.experiment` memoizes only the *selection*, not the
		// variant's work, so the run() is what survives retries. The weighted split
		// is seeded with the run ID, so a replay always re-selects the same variant.
		const { result: summary, experimentRef } = await group.experiment(
			"summary-strategy",
			{
				variants: {
					questionLed: () =>
						step.run("summarize-question-led", () =>
							generateSummary(story, enriched, "questionLed"),
						),
					factLed: () =>
						step.run("summarize-fact-led", () =>
							generateSummary(story, enriched, "factLed"),
						),
				},
				select: experiment.weighted({ questionLed: 50, factLed: 50 }),
			},
		);
		await step.run("save-summary", () =>
			saveSummary(storyId, summary, {
				name: experimentRef.experimentName,
				variant: experimentRef.variant,
			}),
		);

		// Scoring runs only after the save succeeds, so grading can never block or
		// break the summary readers already see. The deterministic guardrails are
		// pure checks over the summary string and always run, run-scoped.
		await step.score("guard-length", {
			name: "length",
			value: lengthOk(summary),
		});
		await step.score("guard-emdash", {
			name: "emdash",
			value: noEmdash(summary),
		});
		await step.score("guard-sentences", {
			name: "sentences",
			value: sentenceCountOk(summary),
		});
		await step.score("guard-refusal", {
			name: "refusal",
			value: notRefusal(summary),
		});

		// Defer the LLM-as-judge: it runs as its own retryable scorer run rather
		// than inline here, so a slow or flaky model call never blocks the summary.
		// We hand it the served variant via `experiment`, which surfaces on the
		// scorer's `ctx.parents[0].experiment` so it can attribute its three axes.
		defer("judge-summary", {
			function: judgeSummaryScorer,
			experiment: experimentRef,
			data: {
				storyId,
				summary,
				articleText: enriched.articleText ?? null,
				title: story.title,
			},
		});

		return { storyId, summary };
	},
);
