import { useRouteContext } from "@tanstack/react-router";
import type { Session } from "./auth";

/**
 * The one canonical way to ask "who am I" from client code. The session is
 * resolved once per route-tree evaluation in the root route's `beforeLoad`
 * (see __root.tsx) and handed down through router context — this just reads it
 * back out, so every surface (nav, index, story page, settings/saved guards)
 * shares the exact same lookup instead of each re-deriving it.
 */
export function useSession(): Session | null {
	return useRouteContext({ from: "__root__", select: (c) => c.user });
}
