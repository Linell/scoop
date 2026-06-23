import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODELS } from "#/server/llm";
import { looksLikeRefusal } from "#/server/summarize";

/**
 * Grades a finished summary. Two kinds of signal live here: an LLM-as-judge
 * (Opus reads the article + summary and rates it on three axes) and cheap
 * deterministic guardrails over the summary string alone. Both feed `step.score`
 * in the summarize job; neither is allowed to break a run, so the judge is
 * strictly best-effort and the guardrails are pure functions that can't throw.
 */

/** The three 0..1 axes the judge returns. */
export type JudgeScores = {
	faithfulness: number;
	teaser: number;
	spoiler: number;
};

const JUDGE_SYSTEM = `You grade one-to-two sentence summaries written to make a reader want to open a story.
Read the article text and the summary, then rate the summary on three axes from 0 to 1.
Judge only against the article text provided; do not use outside knowledge.`;

const JUDGE_TOOL: Anthropic.Tool = {
	name: "score",
	description:
		"Return the three quality scores for the summary, each a number from 0 (worst) to 1 (best on that axis's own scale).",
	input_schema: {
		type: "object",
		properties: {
			faithfulness: {
				type: "number",
				description:
					"How well the summary's claims are supported by the article text. 1 = every claim is backed; 0 = invented or contradicted.",
			},
			teaser: {
				type: "number",
				description:
					"How well the summary opens a curiosity gap that makes a reader want to click. 1 = a strong, honest hook; 0 = flat or off-putting.",
			},
			spoiler: {
				type: "number",
				description:
					"How much the summary gives away, leaving no reason to open the story. HIGH IS BAD: 1 = the payoff is fully spoiled; 0 = it teases without revealing.",
			},
		},
		required: ["faithfulness", "teaser", "spoiler"],
	},
};

/** Coerce an unknown tool field to a number clamped into 0..1, or null. */
function score01(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value)
		? Math.min(1, Math.max(0, value))
		: null;
}

/**
 * LLM-as-judge over a finished summary. Reuses the article text the summarize
 * job already fetched so we grade against the real source. Best-effort: any
 * error, refusal, or unparseable result returns null so the caller skips
 * scoring without failing the run.
 */
export async function judgeSummary(
	summary: string,
	articleText: string | null,
	title: string,
): Promise<JudgeScores | null> {
	try {
		const article = articleText?.trim();
		// Nothing to judge faithfulness against — skip rather than guess.
		if (!article) return null;

		const message = await anthropic().messages.create({
			model: MODELS.judge,
			max_tokens: 256,
			system: JUDGE_SYSTEM,
			tools: [JUDGE_TOOL],
			tool_choice: { type: "tool", name: "score" },
			messages: [
				{
					role: "user",
					content: `Title: ${title}\n\nArticle text:\n${article}\n\nSummary:\n${summary}`,
				},
			],
		});

		const tool = message.content.find(
			(b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
		);
		const input = tool?.input as Partial<JudgeScores> | undefined;

		const faithfulness = score01(input?.faithfulness);
		const teaser = score01(input?.teaser);
		const spoiler = score01(input?.spoiler);
		if (faithfulness === null || teaser === null || spoiler === null)
			return null;

		return { faithfulness, teaser, spoiler };
	} catch {
		return null;
	}
}

/** ~55-word ceiling — the summary should stay glanceable on a card. */
const MAX_SUMMARY_WORDS = 55;

function wordCount(summary: string): number {
	const trimmed = summary.trim();
	return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Summary is within the word budget. */
export function lengthOk(summary: string): boolean {
	return wordCount(summary) <= MAX_SUMMARY_WORDS;
}

/** Summary avoids the emdash the SYSTEM prompt forbids. */
export function noEmdash(summary: string): boolean {
	return !summary.includes("—");
}

/** Summary is 1 to 3 sentences. */
export function sentenceCountOk(summary: string): boolean {
	const sentences = summary
		.split(/[.!?]+/)
		.map((s) => s.trim())
		.filter(Boolean);
	return sentences.length >= 1 && sentences.length <= 3;
}

/** Summary isn't a model refusal that slipped past the summarizer backstop. */
export function notRefusal(summary: string): boolean {
	return !looksLikeRefusal(summary);
}
