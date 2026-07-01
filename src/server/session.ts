import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { Session } from "#/lib/auth";
import { getSession } from "./db";

/** RPC-bridged wrapper around `getSession` so `__root.tsx` (shipped to the
 *  client bundle) can resolve the session through a stripped handler body. */
export const resolveSession = createServerFn({ method: "GET" }).handler(
	async (): Promise<Session | null> => getSession(getRequest()),
);
