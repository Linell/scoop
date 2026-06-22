import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { serve } from "inngest/edge";
import { functions, inngest } from "#/inngest";

/**
 * The Inngest serve handler. Inngest hits this endpoint to discover and invoke
 * functions. `inngest/edge` is used because the app runs on Cloudflare Workers.
 */
const handler = serve({
	client: inngest,
	functions,
});

export const Route = createFileRoute("/api/inngest")({
	server: {
		handlers: {
			GET: ({ request }) => handler(request),
			POST: ({ request }) => handler(request),
			PUT: ({ request }) => handler(request),
		},
	},
});
