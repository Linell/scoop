/**
 * Pure URL/hash helpers shared by the server ingest path and the client.
 * Kept free of the XML parser so importing them client-side stays cheap.
 */

/** Stable, synchronous hash (FNV-1a → base36) used for feed/story dedup keys. */
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
