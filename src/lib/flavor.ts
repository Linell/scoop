import { hashId } from "./url";

/**
 * The ice-cream palette + per-feed color helpers. Used to live in
 * subscriptions.ts (back when subscriptions were the only thing that needed a
 * color), but both the account-backed subscriptions list and collections.ts's
 * folder tree need the palette too, so it lives here now — a neutral module
 * with no localStorage/server coupling of its own.
 */

// The ice-cream palette, in the order we hand colors out.
export const FLAVORS = [
	"var(--strawberry)",
	"var(--mint)",
	"var(--blueberry)",
	"var(--lemon)",
	"var(--taro)",
	"var(--mango)",
] as const;

/** A followed feed: its id plus the flavor color it wears in this reader's UI. */
export type Subscription = {
	id: string;
	flavor: string;
};

/**
 * Stable flavor color for a feed: hash the feed id into the ice-cream palette so
 * the same feed wears the same color across every surface (the story page, the
 * /saved cards, and the shared-list previews). Order-independent, unlike the
 * positional FLAVORS[i % n] dots we hand out to subscriptions in creation order.
 */
export function flavorForFeed(feedId: string): string {
	const n = Number.parseInt(hashId(feedId), 36);
	return FLAVORS[n % FLAVORS.length];
}
