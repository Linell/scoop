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
	discussionUrl: string | null; // comments/discussion page (e.g. the HN thread); null when the feed has none
	title: string;
	author: string | null;
	content: string | null;
	imageUrl: string | null; // representative image from the feed; null when none
	publishedAt: number | null; // epoch ms; null when the feed gave no usable date
	summary: string | null; // AI summary; null until the summarize job fills it in
	servedVariant: string | null; // experiment variant that produced the summary; null pre-experiment
	experimentName: string | null; // experiment the variant belongs to; null pre-experiment
	summarizeRunId: string | null; // Inngest run that produced the summary; lets later scorers attribute to its variant. null pre-experiment
	rating: "good" | "oversold" | "spoiled" | null; // a reader's rating of the summary; null until rated
};

/**
 * The seed shape: feed metadata sourced from the awesome-rss-feeds OPML files at
 * build time (see scripts/build-catalog.ts) and written to src/data/catalog.json.
 * Consumed once by scripts/seed-catalog.ts to populate the D1 `feeds` table;
 * never read at runtime once seeded.
 */
export type SeedFeed = {
	title: string;
	url: string;
	siteUrl: string | null;
	description: string | null;
	category: string;
};

/**
 * A live discovery-catalog entry, served from the D1 `feeds` table by the
 * getCatalog server fn (the browse dialog's data source). Purely for browse +
 * search — following one routes through the subscribe path by `url`/id.
 */
export type CatalogFeed = {
	title: string;
	url: string;
	siteUrl: string | null;
	description: string | null;
	category: string;
	iconUrl: string | null; // site favicon for a nicer browse row; null when unknown
	subscriberCount: number; // how many visitors follow this feed, for popularity ranking
};
