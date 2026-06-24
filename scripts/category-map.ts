/**
 * Clean, consolidated feed-category taxonomy for Scoop.
 *
 * The raw `category` values in `src/data/catalog.json` were inherited from
 * awesome-rss-feeds OPML filenames plus a small hand-curated set, leaving ~43
 * inconsistent buckets (junk casing, near-synonyms, overly-granular splits).
 * This module collapses them into a tight, mutually-clear set of consumer-
 * reader categories.
 *
 * `categoryFor` is applied by `scripts/seed-catalog.ts` when emitting each
 * feed's `category`, so the seeded DB carries only clean names. The runtime
 * classifier reads DISTINCT categories from that DB as its allowed list, so
 * these names double as the model-facing label set — they are deliberately
 * clear and non-overlapping.
 */

/**
 * The canonical taxonomy, in display order. Ordered roughly by size / how
 * central each bucket is to a cozy general-interest reader.
 */
export const CATEGORIES = [
	"Technology",
	"Programming",
	"Science",
	"Business & Finance",
	"Politics & World",
	"Sports",
	"Gaming",
	"Culture & Arts",
	"Humor & Memes",
	"Design",
	"Home & DIY",
	"Food & Drink",
	"Style & Beauty",
	"Nature & Environment",
	"Travel",
	"Cars",
] as const;

/**
 * Old catalog category -> clean category. Every distinct value currently in
 * `src/data/catalog.json` appears here exactly once.
 */
export const CATEGORY_MAP: Record<string, string> = {
	// Technology: consumer/industry tech news + platform-specific coverage +
	// security (which reads as a tech-news beat here, not a coding discipline).
	Tech: "Technology",
	Apple: "Technology",
	Android: "Technology",
	"Cyber security": "Technology",

	// Programming: software engineering / building things. Web & mobile dev are
	// disciplines within programming, not separate reader interests.
	Programming: "Programming",
	"Web Development": "Programming",
	"Android Development": "Programming",
	"iOS Development": "Programming",

	// Science: pure science + space (too few space feeds to stand alone).
	Science: "Science",
	Space: "Science",

	// Business & Finance: markets, economy, startups, personal finance, crypto.
	// These were four small-to-mid buckets all about money/business.
	"Business & Economy": "Business & Finance",
	Startups: "Business & Finance",
	"Personal finance": "Business & Finance",
	Cryptocurrency: "Business & Finance",

	// Politics & World: general/world news.
	News: "Politics & World",

	// Sports: every individual sport collapses here (chess included as a
	// competitive game/sport beat). No reason to surface per-sport buckets.
	Sports: "Sports",
	Cricket: "Sports",
	Tennis: "Sports",
	Football: "Sports",
	"American Football": "Sports",
	Baseball: "Sports",
	Chess: "Sports",

	// Gaming: video games.
	Gaming: "Gaming",

	// Culture & Arts: film/TV, books, music, history, photography — the arts &
	// humanities. Film & TV folds in here rather than standing as a thin bucket.
	Movies: "Culture & Arts",
	Television: "Culture & Arts",
	Books: "Culture & Arts",
	Music: "Culture & Arts",
	History: "Culture & Arts",
	Photography: "Culture & Arts",

	// Humor & Memes: comedy + meme/image-board content.
	Funny: "Humor & Memes",
	Memes: "Humor & Memes",

	// Design: visual/spatial design across UI/UX, interiors, and architecture.
	"UI - UX": "Design",
	"Interior design": "Design",
	Architecture: "Design",

	// Home & DIY: making/fixing/decorating at home.
	DIY: "Home & DIY",

	// Food & Drink.
	Food: "Food & Drink",

	// Style & Beauty: fashion + beauty.
	Fashion: "Style & Beauty",
	Beauty: "Style & Beauty",

	// Nature & Environment: nature, conservation/climate, wildlife.
	Nature: "Nature & Environment",
	Environment: "Nature & Environment",
	"Animal & Wildlife": "Nature & Environment",

	// Travel.
	Travel: "Travel",

	// Cars.
	Cars: "Cars",
};

/** Default bucket for any category not present in CATEGORY_MAP. */
const DEFAULT_CATEGORY = "Culture & Arts";

/**
 * Map any raw catalog category to a clean taxonomy name. Unknown values fall
 * back to a sensible general-interest bucket rather than introducing an
 * "Other" dumping ground.
 */
export function categoryFor(rawCategory: string): string {
	return CATEGORY_MAP[rawCategory] ?? DEFAULT_CATEGORY;
}
