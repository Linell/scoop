/**
 * Shared response headers for the read-only public catalog API routes
 * (/api/feeds and /api/feeds/opml): permissive CORS so other sites/tools can
 * read the catalog, plus a short shared cache window. Kept in one place so the
 * payload and preflight responses across both endpoints can't drift.
 */

export const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
} as const;

export const CACHE_CONTROL = "public, max-age=300";
