import { Inngest } from "inngest";
import { scoreMiddleware } from "inngest/experimental";

/**
 * The Inngest client. The `id` uniquely identifies this app to Inngest
 * (locally via the Dev Server, and in production via Inngest Cloud).
 *
 * `scoreMiddleware` adds `step.score(...)` to the function context so jobs can
 * emit durable scores (LLM-as-judge + guardrails) alongside their work.
 */
export const inngest = new Inngest({
	id: "scoop",
	middleware: [scoreMiddleware()],
});
