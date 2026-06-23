import { useCallback } from "react";
import { createLocalStore } from "./local-store";
import { useSaved } from "./saved";
import { FLAVORS } from "./subscriptions";

/**
 * Collections are the reader's own hierarchy over their reading list — nested
 * folders ("lists") that a saved story can belong to in many places at once.
 * Like subscriptions and the saved list, they live entirely in localStorage
 * (no auth, no server). Membership itself isn't stored here; it lives on each
 * SavedStory's `collections` array (see saved.ts). This module is just the tree
 * of folders: a flat array of nodes, each pointing at its parent (or null at a
 * root), with a stable flavor color so a collection keeps its look.
 */

const STORAGE_KEY = "scoop.collections.v1";

export type Collection = {
	id: string;
	name: string;
	parent: string | null;
	color: string;
};

const store = createLocalStore<Collection[]>({
	key: STORAGE_KEY,
	fallback: [],
	validate: (parsed) =>
		Array.isArray(parsed)
			? parsed.filter(
					(c): c is Collection =>
						c &&
						typeof c.id === "string" &&
						typeof c.name === "string" &&
						(c.parent === null || typeof c.parent === "string") &&
						typeof c.color === "string",
				)
			: [],
});

// --- Pure tree helpers -----------------------------------------------------
// Free functions over a collection array, so the /saved page (and the share
// merge) can reason about the tree without going through the hook.

/** Direct children of `id` (or the roots when `id` is null), in array order. */
export function childrenOf(
	collections: Collection[],
	id: string | null,
): Collection[] {
	return collections.filter((c) => c.parent === id);
}

/** The root collections — those with no parent. */
export function roots(collections: Collection[]): Collection[] {
	return childrenOf(collections, null);
}

/**
 * Every collection in `id`'s subtree, inclusive of `id` itself, as a Set of
 * ids. Walks children breadth-first and guards against cycles (a corrupted
 * store could point a node back at one of its ancestors) by never revisiting an
 * id already in the set.
 */
export function descendantsOf(
	collections: Collection[],
	id: string,
): Set<string> {
	const out = new Set<string>([id]);
	const queue = [id];
	while (queue.length > 0) {
		const current = queue.shift() as string;
		for (const child of collections) {
			if (child.parent === current && !out.has(child.id)) {
				out.add(child.id);
				queue.push(child.id);
			}
		}
	}
	return out;
}

export function useCollections() {
	// Start empty so server and first client render agree, then hydrate from
	// localStorage in an effect — same dance as the other localStorage hooks.
	const {
		value: collections,
		setValue: setCollections,
		hydrated,
	} = store.useStore();

	/**
	 * Mint a new collection under `parent` (root when omitted/null). The next
	 * flavor color is handed out by current count, mirroring useSubscriptions, so
	 * collections cycle the ice-cream palette in creation order. Returns the new
	 * id so the caller can immediately select or assign into it.
	 */
	const create = useCallback(
		(name: string, parent: string | null = null): string => {
			const id = crypto.randomUUID();
			setCollections((prev) => {
				const color = FLAVORS[prev.length % FLAVORS.length];
				return [...prev, { id, name, parent, color }];
			});
			return id;
		},
		[setCollections],
	);

	const rename = useCallback(
		(id: string, name: string) => {
			setCollections((prev) =>
				prev.map((c) => (c.id === id ? { ...c, name } : c)),
			);
		},
		[setCollections],
	);

	/**
	 * Remove a collection, re-parenting its direct children onto the removed
	 * node's parent so the tree stays connected. We deliberately do NOT
	 * cascade-delete descendants — a reader deleting a folder shouldn't lose the
	 * sub-folders nested inside it. (Stripping the id off saved stories is the
	 * caller's job; see saved.stripCollection.)
	 */
	const remove = useCallback(
		(id: string) => {
			setCollections((prev) => {
				const removed = prev.find((c) => c.id === id);
				if (!removed) return prev;
				return prev
					.filter((c) => c.id !== id)
					.map((c) => (c.parent === id ? { ...c, parent: removed.parent } : c));
			});
		},
		[setCollections],
	);

	/**
	 * Move `id` under a new parent. Guards against cycles: re-parenting a node
	 * into its own subtree (or onto itself) would orphan the branch, so we
	 * no-op rather than corrupt the tree.
	 */
	const reparent = useCallback(
		(id: string, parent: string | null) => {
			setCollections((prev) => {
				if (id === parent) return prev;
				if (parent !== null && descendantsOf(prev, id).has(parent)) return prev;
				return prev.map((c) => (c.id === id ? { ...c, parent } : c));
			});
		},
		[setCollections],
	);

	/** Low-level bulk setter — used by the shared-collection import/merge. */
	const replaceAll = useCallback(
		(next: Collection[]) => {
			setCollections(next);
		},
		[setCollections],
	);

	return {
		collections,
		hydrated,
		create,
		rename,
		remove,
		reparent,
		replaceAll,
	};
}

/**
 * The reading list as a whole: the collections tree and the saved stores joined
 * at one point, so the operations that must touch BOTH can't be split. Each
 * createLocalStore hook holds its own React state per call site, so a page must
 * go through a single instance of each — this hook is that instance. It spreads
 * both surfaces through and adds the composed cross-store ops on top.
 *
 * `deleteCollection`, in particular, must drop the folder AND strip its tag off
 * every saved story; doing only one desyncs the stores (an orphaned colId tag),
 * which is exactly the bug a single composed op prevents.
 */
export function useReadingList() {
	const collections = useCollections();
	const saved = useSaved();

	/** Delete a collection across both stores: drop the folder (re-parenting its
	 * children) and strip its tag off every saved story. */
	const deleteCollection = useCallback(
		(id: string) => {
			collections.remove(id);
			saved.stripCollection(id);
		},
		[collections.remove, saved.stripCollection],
	);

	return { collections, saved, deleteCollection };
}
