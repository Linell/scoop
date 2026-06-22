/**
 * Pure URL/hash helpers shared by the server ingest path and the client.
 * Kept free of the XML parser so importing them client-side stays cheap.
 */

/**
 * Stable, synchronous hash (FNV-1a → base36) used for feed/story dedup keys.
 *
 * This is a 32-bit hash, so the output space is ~4.3B values. By the birthday
 * bound that means ~50% odds of at least one collision once the catalog holds
 * roughly 65k keys (sqrt of 2^32). Because these hashes are the PRIMARY KEY for
 * both feeds and stories, a collision makes INSERT OR IGNORE silently drop the
 * losing row — acceptable at demo scale, but this is the ceiling to widen
 * (e.g. a 64-bit hash) if the shared catalog ever grows large.
 */
export function hashId(input: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
}

/** Normalize a feed URL so the same feed dedupes regardless of trivial diffs. */
export function normalizeUrl(raw: string): string {
	let value = raw.trim();
	if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
	try {
		const url = new URL(value);
		url.hash = "";
		url.hostname = url.hostname.toLowerCase();
		// Drop a trailing slash on the path for stability.
		if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
			url.pathname = url.pathname.slice(0, -1);
		}
		return url.toString();
	} catch {
		return value;
	}
}

/** The catalog id a feed URL will resolve to (same on client and server). */
export function feedIdForUrl(rawUrl: string): string {
	return hashId(normalizeUrl(rawUrl));
}

/** Surfaces that can send a reader to an article, for click attribution. */
export type ClickSource = "chat" | "story" | "feed";

/**
 * Link to an article through the click tracker (/r/$storyId) instead of straight
 * to its url, so every outbound click is captured. `cid` ties a chat click to its
 * conversation session; omit it on other surfaces. Used everywhere so all links
 * are built identically.
 */
export function storyClickHref(
	storyId: string,
	from: ClickSource,
	cid?: string,
): string {
	const params = new URLSearchParams({ from });
	if (cid) params.set("cid", cid);
	return `/r/${storyId}?${params}`;
}
