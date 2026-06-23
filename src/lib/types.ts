/** Shapes shared between the server functions and the client. */

export type Feed = {
	id: string;
	feedUrl: string;
	title: string;
	siteUrl: string | null;
	description: string | null;
	fetchedAt: number;
};

export type Story = {
	id: string;
	feedId: string;
	url: string;
	title: string;
	author: string | null;
	content: string | null;
	imageUrl: string | null; // representative image from the feed; null when none
	publishedAt: number | null; // epoch ms; null when the feed gave no usable date
	summary: string | null; // AI summary; null until the summarize job fills it in
	servedVariant: string | null; // experiment variant that produced the summary; null pre-experiment
	experimentName: string | null; // experiment the variant belongs to; null pre-experiment
	rating: "good" | "oversold" | "spoiled" | null; // a reader's rating of the summary; null until rated
};

/**
 * A discovery-catalog entry: feed metadata sourced from the awesome-rss-feeds
 * OPML files at build time (see scripts/build-catalog.ts). Purely for browse +
 * search — adding one still routes through the live ingest path by `url`.
 */
export type CatalogFeed = {
	title: string;
	url: string;
	siteUrl: string | null;
	description: string | null;
	category: string;
};
