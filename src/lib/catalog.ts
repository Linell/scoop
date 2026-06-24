import type { CatalogFeed } from "./types.ts";

/**
 * The feed-discovery catalog, served live from D1 by the getCatalog server fn
 * (so newly-submitted feeds show up for everyone). Fetched on first use and
 * cached as a promise — it's only needed once the browse dialog opens.
 */

let cache: Promise<CatalogFeed[]> | null = null;

export function loadCatalog(): Promise<CatalogFeed[]> {
	if (!cache) {
		// Lazy-import the server fn so this client lib never statically pulls the
		// server module graph (cloudflare:workers/D1) into the client bundle or a
		// unit test that happens to import it — same reasoning as subscriptions.ts.
		cache = import("#/server/feeds").then((m) => m.getCatalog());
	}
	return cache;
}

export type CatalogGroup = { category: string; feeds: CatalogFeed[] };

/** Bucket feeds by category, preserving the catalog's sorted order. */
export function groupByCategory(feeds: CatalogFeed[]): CatalogGroup[] {
	const groups = new Map<string, CatalogFeed[]>();
	for (const feed of feeds) {
		const bucket = groups.get(feed.category);
		if (bucket) bucket.push(feed);
		else groups.set(feed.category, [feed]);
	}
	return [...groups.entries()].map(([category, items]) => ({
		category,
		feeds: items,
	}));
}
