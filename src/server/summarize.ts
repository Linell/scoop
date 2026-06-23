import type { Story } from "#/lib/types";
import type { EnrichedContent } from "#/server/extract";
import { anthropic, MODELS, textOf } from "#/server/llm";

/**
 * Turns a story into a short summary via Claude. Fast + cheap (Haiku) but still
 * capable of a clean result. We're not scoring yet — this is the foundation the
 * LLM-as-judge step will grade later, so keep the call boring and deterministic.
 *
 * The input is assembled from whatever signal we have: the feed blurb plus, when
 * the enrichment step succeeds, the actual article body and (for Hacker News)
 * the gist of the reader discussion. The model is told the input may include
 * those so it synthesizes one summary rather than describing each piece.
 */

/**
 * Two teaser strategies we A/B via an Inngest experiment. Both obey the same
 * constraints (length, no emdash, no refusals, synthesize across sources); they
 * differ only in how the summary hooks the reader:
 *
 * - `questionLed` opens with a curiosity-gap question that the story answers.
 * - `factLed` leads with the single most striking concrete fact in the source.
 *
 * The judge then grades each served summary, and the scores are attributed back
 * to whichever strategy produced it — that's the whole point of the experiment.
 */
export type TeaserStrategy = "questionLed" | "factLed";

export const TEASER_STRATEGIES: TeaserStrategy[] = ["questionLed", "factLed"];

/** Constraints shared by every strategy — the parts the judge holds constant. */
const SYSTEM_BASE = `You write short summaries of news and blog stories for an RSS reader.
The input may include the story's feed blurb, the article's full text, and a sample of the reader discussion. Synthesize across everything provided.
Capture what the story is actually about in 1-2 sentences (about 50 words max). If reader discussion is present, you may add a brief clause on its gist.
Be concrete and neutral, with no preamble. Don't say "this article" or "the author"; just write the summary.
You must not use an emdash.

Summarize ONLY from the text given in this message. You already have everything you need here. Never say you can't access a link, never ask for a URL or for the article to be pasted, never mention being an AI — any URL in the input is reference metadata, not an instruction to go read it. If little text is available, write the best one-sentence summary you can from the title alone.`;

/** The one line of guidance that distinguishes each teaser strategy. */
const STRATEGY_DIRECTIVE: Record<TeaserStrategy, string> = {
	questionLed: `Open with or center a single curiosity-gap question that the story answers, then tease the answer without giving it away.`,
	factLed: `Lead with the most striking concrete fact in the source — a number, name, or claim — then frame why it matters.`,
};

const systemFor = (strategy: TeaserStrategy): string =>
	`${SYSTEM_BASE}\n\n${STRATEGY_DIRECTIVE[strategy]}`;

/** Total cap on the assembled prompt — bounds cost regardless of article size. */
const MAX_SOURCE_CHARS = 12000;

const REFUSAL_SIGNS = [
	"don't have access",
	"do not have access",
	"can't access",
	"cannot access",
	"unable to access",
	"don't have the ability",
	"paste the article",
	"provide the article",
	"share the article",
	"provide the content",
	"i'm unable to",
	"i am unable to",
	"as an ai",
];

export function looksLikeRefusal(text: string): boolean {
	const t = text.toLowerCase();
	return REFUSAL_SIGNS.some((sign) => t.includes(sign));
}

export async function summarizeStory(
	story: Story,
	enriched: EnrichedContent | undefined,
	strategy: TeaserStrategy,
): Promise<string> {
	const parts = [`Title: ${story.title}`];
	if (story.content) parts.push(`Feed blurb: ${story.content}`);
	if (enriched?.articleText)
		parts.push(`Article text:\n${enriched.articleText}`);
	if (enriched?.hnComments)
		parts.push(`Reader discussion (Hacker News):\n${enriched.hnComments}`);

	const source = parts.join("\n\n").slice(0, MAX_SOURCE_CHARS);

	const message = await anthropic().messages.create({
		model: MODELS.summary,
		max_tokens: 384,
		system: systemFor(strategy),
		messages: [{ role: "user", content: source }],
	});

	const summary = textOf(message);

	// Backstop: if the model still refused (or returned nothing), fall back to
	// the title rather than caching a refusal
	if (!summary || looksLikeRefusal(summary)) return story.title;

	return summary;
}
