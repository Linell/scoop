/**
 * Shared, secret-free auth constants/types. Safe to import from client or
 * server code — the actual session lookup (which needs the SESSION_CACHE
 * binding and talks to voodoo) lives in #/server/auth.ts.
 */

export const VOODOO_URL = "https://voodoo.thelinell.com";
export const VOODOO_COOKIE_NAME = "voodoo_session";
export const VOODOO_COOKIE_DOMAIN = ".thelinell.com";

export type Session = {
	id: string;
	email: string;
	isAdmin: boolean;
	timezone: string;
};

/** Where voodoo should send the reader back to once they've signed in. */
export function voodooLoginUrl(next: string): string {
	return `${VOODOO_URL}/login?next=${encodeURIComponent(next)}`;
}
