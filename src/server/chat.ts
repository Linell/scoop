import type Anthropic from "@anthropic-ai/sdk";
import { createServerFn } from "@tanstack/react-start";
import { type ChatCitation, storyToCitation } from "#/lib/citation";
import type { Feed, Story } from "#/lib/types";
import { getFeedsByIds, getStoriesByFeedIds } from "#/server/db";
import { MAX_FEED_IDS } from "#/server/feeds";
import { anthropic, MODELS } from "#/server/llm";

export type { ChatCitation } from "#/lib/citation";

/**
 * Ask Scoop: a focused chat over the stories in a visitor's feeds. It is NOT a
 * general assistant — every answer is grounded in the feed catalog we hand the
 * model, and the goal of each reply is to point the reader at a story worth
 * opening. Subscriptions live in localStorage, so the client passes the feed
 * ids; the server hydrates the matching stories and never sees per-user data.
 */

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ChatReply = { reply: string; citations: ChatCitation[] };

type ChatRequest = { turns: ChatTurn[]; feedIds: string[] };

// Bounds: how much feed context we feed the model, and how many turns of
// history we trust from the client. Plenty for a demo; keeps the call cheap.
const MAX_STORIES = 60;
const MAX_TURNS = 12;
const MAX_CITATIONS = 4;

const SYSTEM = `You are Scoop: a playful, warm guide to the stories in the reader's RSS feeds. Think of yourself as the friend who leans over and says "ok you HAVE to read this one" without spoiling why.

WHAT YOU KNOW
You only know the stories listed below. Never invent stories, facts, numbers, quotes, or links, and never answer questions unrelated to these feeds. If nothing fits, say so plainly in one sentence and point to the closest story you do have.

YOUR JOB: TEASE, DON'T TELL
Each story you surface is shown to the reader as a separate clickable card with its title and source. Your reply is the spark that makes them want to tap it. The real payoff lives at the source, so your job is to open a curiosity gap, not close it.
- Name the hook, withhold the answer. Say what's at stake or surprising, then stop before the reveal. "One feed found a way to cut their AWS bill by two thirds, and the fix wasn't what you'd guess." NOT "they switched to X and saved 65%."
- Tease the tension, not the takeaway. Point at the question the story answers. Let them open it to get the answer.
- Be truthful. Only promise what the story actually delivers. No bait the story doesn't pay off, no invented stakes, no fake numbers. If a story is genuinely a quick fact, it's fine to just say it's a quick read.
- Do not restate the card. The title and source already show on the card, so don't repeat them in your prose. Refer to a story by its hook ("the one on the layoffs", "that climate piece"), not by quoting its headline.
- Never reproduce a story's full summary or give a numbered rundown that spoils each one. A list of mini-summaries is the thing to avoid.

HOW MUCH TO SURFACE
- Default to ONE story when there's a clear standout: a single confident pick reads as a real recommendation.
- Surface 2 to 3 only when the reader asks to scan ("what's new", "catch me up") or when a few genuinely compete. Even then, give each a one-line tease, not a summary.
- Order by what's most worth opening first.

VOICE
- Warm, a little playful, never breathless or hypey. You're an ice cream shop, not a tabloid.
- 1 to 3 short sentences, or a few one-line teases for a scan. No preamble, no "Here's what I found".
- Concrete and neutral on facts; the playfulness is in the framing, not in exaggeration.
- Don't say "this article" or "the author". Don't mention being an AI. Don't ask for URLs.
- You may use light **bold** for a single key phrase, but no headings and no bullet or numbered lists.
- You must not use an emdash. Plain sentences and short clauses instead.

Always cite the stories you tease so the reader can open them.`;

const ANSWER_TOOL: Anthropic.Tool = {
	name: "answer",
	description:
		"Reply to the reader with a teasing nudge, then cite the stories worth opening. The reply should make the reader want to click; the cited stories render as separate clickable cards.",
	input_schema: {
		type: "object",
		properties: {
			reply: {
				type: "string",
				description:
					"A short, warm, teasing reply (1-3 sentences) that opens a curiosity gap about the cited stories without summarizing them. Do not restate story titles or sources (the cards show those). Do not reveal the story's payoff. No preamble, no emdash.",
			},
			citations: {
				type: "array",
				items: { type: "integer" },
				description:
					"Story numbers worth opening, most worth opening first, drawn only from the list provided. Prefer a single confident pick; use 2-3 only for scan-style questions or genuine ties. Cite exactly the stories your reply teases.",
			},
		},
		required: ["reply", "citations"],
	},
};

function validate(input: unknown): ChatRequest {
	const req = input as Partial<ChatRequest> | undefined;
	const turns = Array.isArray(req?.turns) ? req.turns : [];
	const feedIds = Array.isArray(req?.feedIds) ? req.feedIds : [];
	return {
		turns: turns
			.filter(
				(t): t is ChatTurn =>
					(t?.role === "user" || t?.role === "assistant") &&
					typeof t?.content === "string",
			)
			.slice(-MAX_TURNS),
		feedIds: feedIds
			.filter((id): id is string => typeof id === "string")
			.slice(0, MAX_FEED_IDS),
	};
}

/** Number the stories so the model can cite them by index (see ANSWER_TOOL). */
function renderCatalog(
	stories: Story[],
	feedTitle: (id: string) => string,
): string {
	return stories
		.map((s, i) => {
			const head = `[${i + 1}] ${s.title} (${feedTitle(s.feedId)})`;
			return s.summary ? `${head}\n${s.summary}` : head;
		})
		.join("\n\n");
}

const noFeeds: ChatReply = {
	reply:
		"You haven't added any flavors yet. Subscribe to a feed or two and I can tell you what's worth reading.",
	citations: [],
};

/** Answer a question about the reader's feeds, with stories worth opening. */
export const askScoop = createServerFn({ method: "POST" })
	.validator(validate)
	.handler(async ({ data: { turns, feedIds } }): Promise<ChatReply> => {
		if (feedIds.length === 0 || turns.length === 0) return noFeeds;

		const [feeds, allStories] = await Promise.all([
			getFeedsByIds(feedIds),
			getStoriesByFeedIds(feedIds),
		]);
		const stories = allStories.slice(0, MAX_STORIES);
		if (stories.length === 0) return noFeeds;

		const titleByFeed = new Map(feeds.map((f: Feed) => [f.id, f.title]));
		const feedTitle = (id: string) => titleByFeed.get(id) ?? "a feed";

		const message = await anthropic().messages.create({
			model: MODELS.chat,
			max_tokens: 256,
			system: `${SYSTEM}\n\nSTORY CATALOG (private briefing: use it to find the hook, never paste these summaries to the reader):\n${renderCatalog(stories, feedTitle)}`,
			tools: [ANSWER_TOOL],
			tool_choice: { type: "tool", name: "answer" },
			messages: turns.map((t) => ({ role: t.role, content: t.content })),
		});

		const tool = message.content.find(
			(b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
		);
		const input = tool?.input as
			| { reply?: string; citations?: number[] }
			| undefined;

		const cited = [...new Set(input?.citations ?? [])]
			.filter((n) => Number.isInteger(n) && n >= 1 && n <= stories.length)
			.slice(0, MAX_CITATIONS);
		const citations = cited.map((n) =>
			storyToCitation(stories[n - 1], feedTitle),
		);

		return {
			reply:
				input?.reply?.trim() ||
				"I couldn't find anything on that in your feeds.",
			citations,
		};
	});
