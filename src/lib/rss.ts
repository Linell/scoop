import { XMLParser } from "fast-xml-parser";

export { feedIdForUrl, hashId, normalizeUrl } from "./url";

/** Polite UA shared by every outbound fetch (feeds + article/comment scraping). */
export const USER_AGENT = "Scoop/1.0 (+https://github.com/inngest; RSS reader)";

/**
 * Minimal RSS 2.0 / Atom fetching + parsing, Workers-friendly (no DOM).
 * We only pull the fields Scoop needs: enough to show a card and link back to
 * the source. Summaries + scores are layered on later in the ingest pipeline.
 */

export type ParsedFeed = {
	title: string;
	siteUrl: string | null;
	description: string | null;
	items: ParsedItem[];
};

export type ParsedItem = {
	url: string;
	guid: string;
	title: string;
	author: string | null;
	content: string | null;
	publishedAt: number | null; // epoch ms, or null when the feed gives no usable date
};

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	// Keep CDATA/text as-is; we strip tags ourselves where needed.
	trimValues: true,
});

/** Treat anything that isn't a non-empty array as a single-or-empty list. */
function asArray<T>(value: T | T[] | undefined | null): T[] {
	if (value == null) return [];
	return Array.isArray(value) ? value : [value];
}

/** fast-xml-parser may hand back a string, a {"#text"} node, or an attr object. */
function text(value: unknown): string {
	if (value == null) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	if (typeof value === "object") {
		const node = value as Record<string, unknown>;
		if (typeof node["#text"] === "string") return node["#text"];
	}
	return "";
}

export function stripHtml(html: string): string {
	return html
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, " ")
		.trim();
}

/** Parse a feed date to epoch ms, or null when it's missing/unparseable. */
function parseDate(value: unknown): number | null {
	const raw = text(value);
	if (!raw) return null;
	const ms = Date.parse(raw);
	return Number.isNaN(ms) ? null : ms;
}

/** Atom links can be an array of {@_rel, @_href}; pick the best "alternate". */
function atomLink(link: unknown): string {
	const links = asArray(link) as Record<string, unknown>[];
	if (links.length === 0) return "";
	const alt = links.find((l) => l["@_rel"] === "alternate" || !l["@_rel"]);
	const chosen = alt ?? links[0];
	return text(chosen["@_href"] ?? chosen);
}

export class FeedError extends Error {}

/** Fetch a URL and parse it as RSS or Atom. Throws FeedError with a friendly message. */
export async function fetchAndParseFeed(feedUrl: string): Promise<ParsedFeed> {
	let res: Response;
	try {
		res = await fetch(feedUrl, {
			headers: {
				// Some hosts 403 a missing UA; identify ourselves politely.
				"user-agent": USER_AGENT,
				accept:
					"application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
			},
			redirect: "follow",
		});
	} catch (cause) {
		throw new FeedError(`Couldn't reach ${feedUrl}.`, { cause });
	}

	if (!res.ok) {
		throw new FeedError(`That feed returned ${res.status}.`);
	}

	const xml = await res.text();

	let doc: Record<string, unknown>;
	try {
		doc = parser.parse(xml) as Record<string, unknown>;
	} catch (cause) {
		throw new FeedError("That doesn't look like a valid feed.", { cause });
	}

	const rss = doc.rss as Record<string, unknown> | undefined;
	const rdf = doc["rdf:RDF"] as Record<string, unknown> | undefined;
	const feed = doc.feed as Record<string, unknown> | undefined;

	if (rss?.channel) return parseRss(rss.channel as Record<string, unknown>);
	if (rdf) return parseRdf(rdf);
	if (feed) return parseAtom(feed);

	throw new FeedError("That doesn't look like an RSS or Atom feed.");
}

// --- internal parsing helpers below ---

function parseRss(channel: Record<string, unknown>): ParsedFeed {
	const items = asArray(channel.item as Record<string, unknown>[]).map(
		(item): ParsedItem => {
			const link = text(item.link);
			const guid = text(item.guid) || link;
			return {
				url: link || guid,
				guid: guid || link,
				title: stripHtml(text(item.title)) || "(untitled)",
				author:
					stripHtml(text(item["dc:creator"]) || text(item.author)) || null,
				content:
					stripHtml(text(item["content:encoded"]) || text(item.description)) ||
					null,
				publishedAt: parseDate(item.pubDate ?? item["dc:date"]),
			};
		},
	);

	return {
		title: stripHtml(text(channel.title)) || "Untitled feed",
		siteUrl: text(channel.link) || null,
		description: stripHtml(text(channel.description)) || null,
		items,
	};
}

/** RDF (RSS 1.0) — items sit as siblings of channel, not nested inside it. */
function parseRdf(rdf: Record<string, unknown>): ParsedFeed {
	const channel = (rdf.channel as Record<string, unknown>) ?? {};
	const items = asArray(rdf.item as Record<string, unknown>[]).map(
		(item): ParsedItem => {
			const link = text(item.link);
			return {
				url: link,
				guid: text(item["@_rdf:about"]) || link,
				title: stripHtml(text(item.title)) || "(untitled)",
				author: stripHtml(text(item["dc:creator"])) || null,
				content: stripHtml(text(item.description)) || null,
				publishedAt: parseDate(item["dc:date"]),
			};
		},
	);

	return {
		title: stripHtml(text(channel.title)) || "Untitled feed",
		siteUrl: text(channel.link) || null,
		description: stripHtml(text(channel.description)) || null,
		items,
	};
}

function parseAtom(feed: Record<string, unknown>): ParsedFeed {
	const entries = asArray(feed.entry as Record<string, unknown>[]).map(
		(entry): ParsedItem => {
			const url = atomLink(entry.link);
			const id = text(entry.id) || url;
			const author = entry.author as Record<string, unknown> | undefined;
			return {
				url: url || id,
				guid: id || url,
				title: stripHtml(text(entry.title)) || "(untitled)",
				author: author ? stripHtml(text(author.name)) || null : null,
				content: stripHtml(text(entry.summary) || text(entry.content)) || null,
				publishedAt: parseDate(entry.published ?? entry.updated),
			};
		},
	);

	return {
		title: stripHtml(text(feed.title)) || "Untitled feed",
		siteUrl: atomLink(feed.link) || null,
		description: stripHtml(text(feed.subtitle)) || null,
		items: entries,
	};
}
