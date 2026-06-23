import { FLAVORS } from "./subscriptions";
import { hashId } from "./url";

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
