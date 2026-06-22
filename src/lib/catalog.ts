import type { CatalogFeed } from "./types.ts";

/**
 * The feed-discovery catalog (see scripts/build-catalog.ts). The data is a
 * committed JSON blob, so we dynamic-import it on first use to keep it out of
 * the initial client bundle — it's only needed once the browse dialog opens.
 */

let cache: Promise<CatalogFeed[]> | null = null;

export function loadCatalog(): Promise<CatalogFeed[]> {
	if (!cache) {
		cache = import("#/data/catalog.json").then(
			(mod) => mod.default as CatalogFeed[],
		);
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
