import { env } from "cloudflare:workers";
import Anthropic from "@anthropic-ai/sdk";

/**
 * The one place we talk to the model provider. Every LLM job (summaries, chat)
 * shares this client and the same model table, so swapping providers or tiers
 * is a one-file change rather than a hunt across the codebase.
 */

let client: Anthropic | undefined;

/** Lazily built, reused for the life of the worker isolate. */
export function anthropic(): Anthropic {
	client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
	return client;
}

/** Models named by the job they do, not the tier, so callers read intent. */
export const MODELS = {
	summary: "claude-haiku-4-5",
	chat: "claude-sonnet-4-6",
	judge: "claude-opus-4-8",
} as const;

/** Flatten a response's text blocks into one trimmed string. */
export function textOf(message: Anthropic.Message): string {
	return message.content
		.filter((block): block is Anthropic.TextBlock => block.type === "text")
		.map((block) => block.text)
		.join("")
		.trim();
}
