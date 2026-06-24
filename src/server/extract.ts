import { stripHtml, USER_AGENT } from "#/lib/rss";
import type { Story } from "#/lib/types";

/**
 * Best-effort enrichment for summarization. Given a story we try to fetch the
 * actual article page (so we summarize the real thing, not a feed teaser) and,
 * for Hacker News items, the top of the discussion. This is a foundation, not a
 * production scraper: extraction is plain string/regex work (Workers have no
 * DOM), every fetch is time-boxed, and any failure falls back to whatever text
 * we already have. Enrichment must NEVER throw — summarization runs regardless.
 */

// Per-fetch wall-clock budget. Page fetches are best-effort; if a host is slow
// we'd rather summarize the feed blurb than block the whole job.
const FETCH_TIMEOUT_MS = 8000;
// The reader proxy renders the page server-side (JS + bot-block handling), so
// it's slower than a raw GET — give it more room before we give up.
const READER_TIMEOUT_MS = 15000;

// Below this many characters we assume the direct fetch was bot-blocked,
// paywalled, or a JS-only shell, and we reach for the reader fallback.
const MIN_ARTICLE_CHARS = 200;

// Size caps keep the prompt (and thus cost + latency) predictable no matter how
// big the page or thread is.
const MAX_ARTICLE_CHARS = 6000;
const MAX_COMMENTS = 6;
const MAX_COMMENT_CHARS = 600;
const MAX_COMMENTS_TOTAL_CHARS = 3000;

/** A polite, time-boxed GET that resolves to null instead of throwing. */
async function safeFetch(
	url: string,
	accept: string,
	timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response | null> {
	try {
		const res = await fetch(url, {
			headers: { "user-agent": USER_AGENT, accept },
			redirect: "follow",
			signal: AbortSignal.timeout(timeoutMs),
		});
		return res.ok ? res : null;
	} catch {
		return null;
	}
}

/**
 * Pull readable text out of an HTML document. No DOM in Workers, so we drop the
 * noisy elements (script/style/head/nav/etc.) wholesale, prefer the <body>, then
 * reuse the feed parser's tag-stripper. Crude but dependency-free and good
 * enough to give the model the article's actual prose.
 */
function extractReadableText(html: string): string {
	const withoutNoise = html
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ")
		.replace(/<head\b[\s\S]*?<\/head>/gi, " ")
		.replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, " ");

	// Prefer the body if we can find it; otherwise strip what's left.
	const body = withoutNoise.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
	return stripHtml(body ? body[1] : withoutNoise);
}

/** Fetch the page directly and extract its readable text (capped), or "". */
async function fetchDirectArticleText(url: string): Promise<string> {
	const res = await safeFetch(url, "text/html, application/xhtml+xml, */*");
	if (!res) return "";

	// Only parse things that look like HTML; a PDF or image won't extract well.
	const type = res.headers.get("content-type") ?? "";
	if (type && !/html|xml|text\/plain/i.test(type)) return "";

	let html: string;
	try {
		html = await res.text();
	} catch {
		return "";
	}
	return extractReadableText(html).slice(0, MAX_ARTICLE_CHARS);
}

/**
 * Fallback for pages a raw GET can't read: bot-blocked, paywalled, or rendered
 * entirely client-side (Steam, many SPAs). r.jina.ai fetches the URL in a real
 * browser server-side and returns clean, LLM-ready text — so the model
 * summarizes the actual article instead of fixating on a bare link. Best-effort
 * like everything here: any failure resolves to "".
 */
async function fetchViaReader(url: string): Promise<string> {
	// The reader takes the target URL (scheme included) appended to its origin.
	const res = await safeFetch(
		`https://r.jina.ai/${url}`,
		"text/plain, */*",
		READER_TIMEOUT_MS,
	);
	if (!res) return "";

	let text: string;
	try {
		text = await res.text();
	} catch {
		return "";
	}
	return text.replace(/\r/g, "").trim().slice(0, MAX_ARTICLE_CHARS);
}

/**
 * Fetch the article at `url` and return its readable text (capped), or "".
 * Tries a cheap direct fetch first; when that comes back empty or too thin to
 * be a real article, falls back to the reader proxy and keeps whichever yielded
 * more text.
 */
async function fetchArticleText(url: string): Promise<string> {
	const direct = await fetchDirectArticleText(url);
	if (direct.length >= MIN_ARTICLE_CHARS) return direct;

	const viaReader = await fetchViaReader(url);
	return viaReader.length > direct.length ? viaReader : direct;
}

/**
 * Find a Hacker News discussion id. The feed's <comments> element (now parsed
 * into `discussionUrl`) is the cleanest source; fall back to the url itself or
 * the content ("Comments URL: …item?id=NNN"), since some items point `url` at
 * the external article with the thread only in content — so check all three.
 */
function hnItemId(story: Story): string | null {
	for (const text of [story.discussionUrl, story.url, story.content]) {
		const match = text?.match(/news\.ycombinator\.com\/item\?id=(\d+)/);
		if (match) return match[1];
	}
	return null;
}

type AlgoliaItem = {
	text: string | null;
	children: AlgoliaItem[] | null;
};

/** Flatten the comment tree into top-level-ish comments, newest layout first. */
function collectComments(root: AlgoliaItem): string[] {
	const out: string[] = [];
	// Breadth-first so we favor higher (usually more substantive) comments before
	// deep reply chains.
	const queue: AlgoliaItem[] = [...(root.children ?? [])];
	while (queue.length > 0 && out.length < MAX_COMMENTS) {
		const node = queue.shift();
		if (!node) continue;
		const text = node.text ? stripHtml(node.text) : "";
		if (text) out.push(text.slice(0, MAX_COMMENT_CHARS));
		if (node.children) queue.push(...node.children);
	}
	return out;
}

/** Fetch the top of an HN thread via the Algolia API. Returns "" on any failure. */
async function fetchHnComments(itemId: string): Promise<string> {
	const res = await safeFetch(
		`https://hn.algolia.com/api/v1/items/${itemId}`,
		"application/json",
	);
	if (!res) return "";

	let item: AlgoliaItem;
	try {
		item = (await res.json()) as AlgoliaItem;
	} catch {
		return "";
	}

	const comments = collectComments(item);
	if (comments.length === 0) return "";

	return comments
		.map((c, i) => `Comment ${i + 1}: ${c}`)
		.join("\n\n")
		.slice(0, MAX_COMMENTS_TOTAL_CHARS);
}

export type EnrichedContent = {
	articleText: string;
	hnComments: string;
};

/**
 * Gather extra context for a story: the article body and (for HN) the
 * discussion. Both fetches run concurrently and independently — one failing
 * never sinks the other, and an all-empty result just means the caller falls
 * back to the feed content.
 */
export async function enrichStory(story: Story): Promise<EnrichedContent> {
	const itemId = hnItemId(story);
	const [articleText, hnComments] = await Promise.all([
		fetchArticleText(story.url),
		itemId ? fetchHnComments(itemId) : Promise.resolve(""),
	]);
	return { articleText, hnComments };
}
