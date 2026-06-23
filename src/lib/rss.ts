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
	imageUrl: string | null; // representative image, or null when the feed has none
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

/** The handful of named entities feeds actually use, beyond the numeric ones. */
const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	hellip: "…",
	mdash: "—",
	ndash: "–",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
	trade: "™",
	copy: "©",
	reg: "®",
};

/**
 * Decode HTML entities — numeric (`&#038;`, `&#x27;`) and the common named
 * ones. Feeds (especially WordPress) frequently double-encode titles, so we
 * decode repeatedly until the string stops changing; that turns a leftover
 * `&amp;#038;` → `&#038;` → `&` instead of leaving "&#038;" on the card.
 */
const ENTITY_RE = /&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi;

function decodeEntities(input: string): string {
	let out = input;
	let changed = true;
	while (changed) {
		changed = false;
		out = out.replace(ENTITY_RE, (match, body) => {
			let decoded: string | undefined;
			if (body[0] === "#") {
				const code =
					body[1] === "x" || body[1] === "X"
						? Number.parseInt(body.slice(2), 16)
						: Number.parseInt(body.slice(1), 10);
				decoded = Number.isFinite(code)
					? String.fromCodePoint(code)
					: undefined;
			} else {
				decoded = NAMED_ENTITIES[body.toLowerCase()];
			}
			if (decoded === undefined) return match;
			changed = true;
			return decoded;
		});
	}
	return out;
}

export function stripHtml(html: string): string {
	return decodeEntities(html.replace(/<[^>]+>/g, " "))
		.replace(/\s+/g, " ")
		.trim();
}

/** Does a URL point at an image we can render? HTTPS-only, so it loads on our
 * HTTPS pages without mixed-content blocks; we never host the bytes ourselves. */
function usableImage(url: string): boolean {
	return /^https:\/\//i.test(url);
}

const IMG_EXT = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i;

/**
 * Pick a representative image URL for an item, or null. We look, in order, at
 * Media RSS nodes (`media:content`, `media:thumbnail`), an image `enclosure`,
 * then the first inline `<img>` in the raw (pre-stripped) content — taking the
 * first HTTPS candidate. `rawContent` is the un-stripped HTML, since stripHtml
 * deletes the `<img>` tags we want to read.
 */
function firstImage(
	item: Record<string, unknown>,
	rawContent: string,
): string | null {
	// Return the first usable HTTPS image, checking sources in priority order so
	// we never scan the article body for an inline <img> when a media node already
	// gave us one. Decode entities on the winner so an inline `src` like
	// `…?w=8&amp;h=10` becomes a real URL rather than one with a bogus query param.
	const pick = (url: string): string | null =>
		usableImage(url) ? decodeEntities(url) : null;

	// media:content — the publisher's lead image, but the node can also describe
	// video/audio, so only take it when it looks like an image.
	for (const node of asArray(item["media:content"])) {
		const rec = node as Record<string, unknown>;
		const url = text(rec["@_url"]);
		const type = text(rec["@_type"]);
		if (
			text(rec["@_medium"]) === "image" ||
			type.startsWith("image/") ||
			IMG_EXT.test(url)
		) {
			const got = pick(url);
			if (got) return got;
		}
	}

	// media:thumbnail is always an image by spec.
	for (const node of asArray(item["media:thumbnail"])) {
		const got = pick(text((node as Record<string, unknown>)["@_url"]));
		if (got) return got;
	}

	// An <enclosure> with an image MIME type (some feeds attach the lead image here).
	for (const node of asArray(item.enclosure)) {
		const rec = node as Record<string, unknown>;
		if (text(rec["@_type"]).startsWith("image/")) {
			const got = pick(text(rec["@_url"]));
			if (got) return got;
		}
	}

	// Fall back to the first inline image embedded in the article body.
	const inline = rawContent.match(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i);
	return inline ? pick(inline[1]) : null;
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
			const rawContent =
				text(item["content:encoded"]) || text(item.description);
			return {
				url: link || guid,
				guid: guid || link,
				title: stripHtml(text(item.title)) || "(untitled)",
				author:
					stripHtml(text(item["dc:creator"]) || text(item.author)) || null,
				content: stripHtml(rawContent) || null,
				imageUrl: firstImage(item, rawContent),
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
			const rawContent = text(item.description);
			return {
				url: link,
				guid: text(item["@_rdf:about"]) || link,
				title: stripHtml(text(item.title)) || "(untitled)",
				author: stripHtml(text(item["dc:creator"])) || null,
				content: stripHtml(rawContent) || null,
				imageUrl: firstImage(item, rawContent),
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
			// Image extraction prefers full content (more likely to carry the lead
			// image) over the summary; the displayed text keeps its summary-first order.
			const rawContent = text(entry.content) || text(entry.summary);
			return {
				url: url || id,
				guid: id || url,
				title: stripHtml(text(entry.title)) || "(untitled)",
				author: author ? stripHtml(text(author.name)) || null : null,
				content: stripHtml(text(entry.summary) || text(entry.content)) || null,
				imageUrl: firstImage(entry, rawContent),
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
