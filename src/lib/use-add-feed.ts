import { useCallback } from "react";
import type { CatalogFeed } from "./types.ts";
import { feedIdForUrl } from "./url.ts";

/**
 * The shared "follow a feed" flow behind the browse dialog, used by both the
 * home page and Settings. Two paths to the same end state:
 *  - `addByUrl`: a pasted/suggested URL that may not be in the catalog yet, so
 *    it ingests (creating the feed + its stories) before following.
 *  - `onDialogAdd`: the dialog's combined handler — a catalog pick is already in
 *    the catalog, so it follows directly (the subscriptions hook records the
 *    server-side subscription and triggers ingest); a pasted URL falls through
 *    to `addByUrl`, which ingests the brand-new feed first.
 *
 * `subscribe` is passed in (callers already hold it from useSubscriptions), so
 * this hook stays free of subscription state. The server fn is lazy-imported so
 * this lib never statically pulls the server graph into the client bundle.
 */
export function useAddFeed(subscribe: (id: string) => void) {
	const addByUrl = useCallback(
		async (url: string): Promise<string | null> => {
			const { addFeed } = await import("#/server/feeds");
			const res = await addFeed({ data: url });
			if (!res.ok) return res.error;
			subscribe(res.feed.id);
			return null;
		},
		[subscribe],
	);

	const onDialogAdd = useCallback(
		async (url: string, catalogFeed?: CatalogFeed): Promise<string | null> => {
			if (catalogFeed) {
				subscribe(feedIdForUrl(catalogFeed.url));
				return null;
			}
			return addByUrl(url);
		},
		[subscribe, addByUrl],
	);

	return { addByUrl, onDialogAdd };
}
