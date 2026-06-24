import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { CACHE_CONTROL, CORS_HEADERS } from "#/lib/api-headers";
import { groupByCategory } from "#/lib/catalog";
import type { CatalogFeed } from "#/lib/types";
import { getCatalog } from "#/server/db";

/**
 * OPML 2.0 export of the whole feed catalog, grouped into one `<outline>` node
 * per category with an `<outline type="rss" ...>` leaf per feed. Served at
 * `/api/feeds/opml` — file-based routing treats the dot in `feeds.opml.ts` as a
 * path separator, so the literal `/api/feeds.opml` path isn't expressible; this
 * is the idiomatic equivalent. A thin, no-auth, cacheable wrapper over
 * `getCatalog()` that any feed reader can import.
 */

/** XML-escape a value for use inside an attribute (handles & < > " '). */
function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/** A single feed leaf: `<outline type="rss" ...>`. */
function feedOutline(feed: CatalogFeed): string {
	const text = escapeXml(feed.title);
	const attrs = [
		`type="rss"`,
		`text="${text}"`,
		`title="${text}"`,
		`xmlUrl="${escapeXml(feed.url)}"`,
	];
	if (feed.siteUrl) attrs.push(`htmlUrl="${escapeXml(feed.siteUrl)}"`);
	if (feed.description) {
		attrs.push(`description="${escapeXml(feed.description)}"`);
	}
	return `      <outline ${attrs.join(" ")} />`;
}

/** Build the full OPML document string from the catalog. */
function buildOpml(feeds: CatalogFeed[]): string {
	// Reuse the catalog's category grouping (preserves the catalog's order).
	const groups = groupByCategory(feeds).map(({ category, feeds: catFeeds }) => {
		const title = escapeXml(category);
		const leaves = catFeeds.map(feedOutline).join("\n");
		return `    <outline text="${title}" title="${title}">\n${leaves}\n    </outline>`;
	});

	return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>Scoop Feed Catalog</title>
  </head>
  <body>
${groups.join("\n")}
  </body>
</opml>
`;
}

async function handleGet(): Promise<Response> {
	const feeds = await getCatalog();
	return new Response(buildOpml(feeds), {
		status: 200,
		headers: {
			"Content-Type": "text/x-opml; charset=utf-8",
			"Cache-Control": CACHE_CONTROL,
			...CORS_HEADERS,
		},
	});
}

export const Route = createFileRoute("/api/feeds/opml")({
	server: {
		handlers: {
			GET: () => handleGet(),
			// CORS preflight: 204 with the allow-* headers, no body.
			OPTIONS: () => new Response(null, { status: 204, headers: CORS_HEADERS }),
		},
	},
});
