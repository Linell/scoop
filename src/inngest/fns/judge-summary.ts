import { createScorer } from "inngest/experimental";
import { z } from "zod";
import { judgeSummary } from "#/server/judge";
import { inngest } from "../client";

/**
 * LLM-as-judge over a finished summary, run as a DEFERRED SCORER instead of
 * inline in `summarize-story`. The summarize job calls
 * `defer("judge-summary", { function: judgeSummaryScorer, experiment, data })`
 * after it saves the summary, so grading runs in its own retryable run and can
 * never block or break the result a reader already sees.
 *
 * Inngest hands the served experiment variant to this scorer via the `defer`
 * call's `experiment` ref, surfaced on `ctx.parents[0].experiment`. The judge
 * rates three axes (faithfulness / teaser / spoiler), so rather than lean on the
 * single auto-attributed return value we emit all three explicitly with
 * `inngest.score.experiment({ ..., experiment })` and return null — keeping the
 * three axes symmetric and all attributed to the same variant.
 */
const schema = z.object({
	storyId: z.string(),
	summary: z.string(),
	articleText: z.string().nullable(),
	title: z.string(),
});

export const judgeSummaryScorer = createScorer(
	inngest,
	{ id: "judge-summary", schema },
	async ({ event, step, parents }) => {
		const { summary, articleText, title } = event.data;

		// Best-effort: the judge returns null on any failure, refusal, or empty
		// article, in which case we emit no scores at all.
		const judged = await step.run("judge", () =>
			judgeSummary(summary, articleText, title),
		);
		if (!judged) return null;

		// The variant the summarize run served, carried through the `defer` call.
		// Without it there's no variant to attribute to, so skip.
		const experiment = parents[0]?.experiment;
		if (!experiment) return null;

		// Emit all three axes attributed to the served variant. (spoiler: HIGH is
		// bad — we keep the judge's own semantics, the experiment view interprets.)
		await inngest.score.experiment({
			name: "faithfulness",
			value: judged.faithfulness,
			experiment,
		});
		await inngest.score.experiment({
			name: "teaser",
			value: judged.teaser,
			experiment,
		});
		await inngest.score.experiment({
			name: "spoiler",
			value: judged.spoiler,
			experiment,
		});

		// All scoring is done via the explicit experiment writes above.
		return null;
	},
);
