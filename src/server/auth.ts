import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { Session } from "#/lib/auth";
import { getSession } from "./db";

/**
 * Auth gate for server fns. `createMiddleware().server()` bodies ARE stripped
 * from the client build (same compiler pass as createServerFn handlers), but
 * only the callback itself — any *other* export sharing this module (e.g. a
 * plain `getSession` helper) would still be reachable by whatever client code
 * imports authMiddleware, and dead-code elimination never drops an exported
 * binding. So the actual D1/KV-touching session lookup lives in server/db.ts
 * (the file everything cloudflare:workers-shaped is proven to funnel through
 * stripped handler/middleware bodies only) — this file just wires it up and
 * never itself imports `cloudflare:workers`.
 */

export const authMiddleware = createMiddleware({ type: "function" }).server(
	async ({ next }) => {
		const user = await getSession(getRequest());
		return next({ context: { user } });
	},
);

/** Narrow a middleware context's `user` to a Session, or throw for handlers that require one. */
export function requireUser(context: { user: Session | null }): Session {
	if (!context.user) throw new Error("Sign in required.");
	return context.user;
}
