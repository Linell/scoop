/**
 * A per-visit "browse session" id. Minted client-side and kept in
 * sessionStorage so a single feed-browsing burst — clicks and ratings — shares
 * one id, letting the dashboard group it as one inspectable session even with
 * no chat. Cleared automatically when the tab closes.
 */

const STORAGE_KEY = "scoop:browse_session";

/**
 * The current tab's browse session id, creating + persisting one on first use.
 * SSR-safe: with no `window`/`sessionStorage` it returns an empty string and
 * mints nothing — the id only exists once we're on the client.
 */
export function getBrowseSession(): string {
	if (typeof window === "undefined" || !window.sessionStorage) return "";
	try {
		let id = window.sessionStorage.getItem(STORAGE_KEY);
		if (!id) {
			id = crypto.randomUUID();
			window.sessionStorage.setItem(STORAGE_KEY, id);
		}
		return id;
	} catch {
		// Private mode / quota — degrade to no session rather than crash.
		return "";
	}
}
