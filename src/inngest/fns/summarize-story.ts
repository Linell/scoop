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
	async ({ event, step, group, defer, runId }) => {
		const storyId = event.data.storyId;

		const story = await step.run("load-story", () => getStoryById(storyId));
		if (!story) return { storyId, skipped: "not-found" };
		if (story.summary) return { storyId, skipped: "already-summarized" };

		if (!story.content?.trim() && !story.url?.trim())
			return { storyId, skipped: "no-content" };

		const enriched = await step.run("fetch-content", () => enrichStory(story));

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
				runId,
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

		await inngest.score.experiment({
			name: "opens",
			value: 0,
			experiment: experimentRef,
		});
		await inngest.score.experiment({
			name: "clickthroughs",
			value: 0,
			experiment: experimentRef,
		});
		await inngest.score.experiment({
			name: "discussions",
			value: 0,
			experiment: experimentRef,
		});
		await inngest.score.experiment({
			name: "saves",
			value: 0,
			experiment: experimentRef,
		});

		// Defer the LLM-as-judge: it runs as its own retryable scorer run rather
		// than inline here, so a slow or flaky model call never blocks the summary.
		// We hand it the served variant via `experiment`
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
