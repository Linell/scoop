import { createFileRoute } from "@tanstack/react-router";
import {
	VOODOO_COOKIE_DOMAIN,
	VOODOO_COOKIE_NAME,
	VOODOO_URL,
} from "#/lib/auth";
import { clearSessionCache } from "#/server/db";

/**
 * Sign-out. POST only: a GET-navigable logout is a CSRF/prefetch hazard with
 * this router's intent-based preloading (a hovered link or prefetch would log
 * the reader out).
 */
async function logout(request: Request): Promise<Response> {
	const cookie = request.headers.get("cookie");

	// Best-effort: voodoo being down must never trap a reader in a stale session.
	if (cookie) {
		try {
			await fetch(`${VOODOO_URL}/logout`, {
				method: "POST",
				headers: { cookie },
			});
		} catch {}
	}

	await clearSessionCache(request);

	return new Response(null, {
		status: 302,
		headers: {
			Location: "/",
			"Set-Cookie": `${VOODOO_COOKIE_NAME}=; Domain=${VOODOO_COOKIE_DOMAIN}; Path=/; Max-Age=0`,
			"Cache-Control": "no-store",
		},
	});
}

export const Route = createFileRoute("/logout")({
	server: {
		handlers: {
			POST: ({ request }) => logout(request),
		},
	},
});
