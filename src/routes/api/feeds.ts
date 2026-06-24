import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { CACHE_CONTROL, CORS_HEADERS } from "#/lib/api-headers";
import { getCatalog } from "#/server/db";

/**
 * Read-only public JSON view of the feed catalog. Served at `/api/feeds`
 * (file-based routing can't carry a `.json` extension cleanly, so this is the
 * idiomatic stand-in for a `/api/feeds.json` endpoint). A thin wrapper over
 * `getCatalog()` — no auth, cacheable, and CORS-open so other sites/tools can
 * read the catalog.
 *
 * Optional `?category=` filters to one category (case-insensitive exact match).
 */

async function handleGet(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const category = url.searchParams.get("category");

	let feeds = await getCatalog();
	if (category) {
		const want = category.toLowerCase();
		feeds = feeds.filter((f) => f.category.toLowerCase() === want);
	}

	const body = JSON.stringify({ feeds, count: feeds.length });

	return new Response(body, {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": CACHE_CONTROL,
			...CORS_HEADERS,
		},
	});
}

export const Route = createFileRoute("/api/feeds")({
	server: {
		handlers: {
			GET: ({ request }) => handleGet(request),
			// CORS preflight: 204 with the allow-* headers, no body.
			OPTIONS: () => new Response(null, { status: 204, headers: CORS_HEADERS }),
		},
	},
});
