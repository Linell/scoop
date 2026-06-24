import { listCategories } from "./db";
import { anthropic, MODELS, textOf } from "./llm";

/**
 * Classify a freshly-submitted feed into one of the catalog's existing
 * categories using a cheap model call, or null when none fit (or anything goes
 * wrong). Purely a nice-to-have on the submit path, so it's deliberately
 * dependency-light and swallows every error back to null — a missing category
 * just means the feed shows up as "Uncategorized".
 */
export async function classifyCategory(feed: {
	title: string;
	description: string | null;
	itemTitles: string[];
}): Promise<string | null> {
	try {
		const taxonomy = await listCategories();
		if (taxonomy.length === 0) return null;

		const items = feed.itemTitles
			.slice(0, 8)
			.map((t) => `- ${t}`)
			.join("\n");

		const message = await anthropic().messages.create({
			model: MODELS.summary,
			max_tokens: 20,
			system:
				"You sort RSS feeds into a fixed catalog of categories. Reply with " +
				"EXACTLY ONE category name copied verbatim from the allowed list that " +
				"best fits the feed, or the single word OTHER if none fit. No other text.",
			messages: [
				{
					role: "user",
					content:
						`Allowed categories:\n${taxonomy.map((c) => `- ${c}`).join("\n")}\n\n` +
						`Feed title: ${feed.title}\n` +
						`Feed description: ${feed.description ?? "(none)"}\n` +
						`Recent item titles:\n${items || "(none)"}\n\n` +
						"Which one category fits best?",
				},
			],
		});

		const reply = textOf(message).trim();
		const match = taxonomy.find((c) => c.toLowerCase() === reply.toLowerCase());
		return match ?? null;
	} catch {
		return null;
	}
}
