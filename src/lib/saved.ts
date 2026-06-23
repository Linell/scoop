import { useCallback } from "react";
import { createLocalStore } from "./local-store";

/**
 * A reader's "save for later" reading list lives entirely in localStorage —
 * same "no auth" story as subscriptions. We store the story id (which points
 * into the shared D1 catalog), when it was saved (so /saved can sort
 * newest-first), and a `collections` field reserved for a later stage.
 */

const STORAGE_KEY = "scoop.saved.v1";

export type SavedStory = {
	storyId: string;
	savedAt: number;
	collections: string[];
};

const store = createLocalStore<SavedStory[]>({
	key: STORAGE_KEY,
	fallback: [],
	validate: (parsed) =>
		Array.isArray(parsed)
			? parsed.filter(
					(s): s is SavedStory =>
						s &&
						typeof s.storyId === "string" &&
						typeof s.savedAt === "number" &&
						Array.isArray(s.collections),
				)
			: [],
});

export function useSaved() {
	// Start empty so server and first client render agree, then hydrate from
	// localStorage in an effect. `hydrated` lets the UI hold skeletons until then.
	const { value: saved, setValue: setSaved, hydrated } = store.useStore();

	const isSaved = useCallback(
		(id: string) => saved.some((s) => s.storyId === id),
		[saved],
	);

	const save = useCallback(
		(id: string) => {
			setSaved((prev) => {
				if (prev.some((s) => s.storyId === id)) return prev;
				return [...prev, { storyId: id, savedAt: Date.now(), collections: [] }];
			});
		},
		[setSaved],
	);

	const unsave = useCallback(
		(id: string) => {
			setSaved((prev) => prev.filter((s) => s.storyId !== id));
		},
		[setSaved],
	);

	const toggle = useCallback(
		(id: string) => {
			setSaved((prev) =>
				prev.some((s) => s.storyId === id)
					? prev.filter((s) => s.storyId !== id)
					: [...prev, { storyId: id, savedAt: Date.now(), collections: [] }],
			);
		},
		[setSaved],
	);

	// --- Collection membership ---------------------------------------------
	// A saved story's `collections` array is its membership in the folder tree
	// (see collections.ts). These keep that array tidy: ids are deduped, and a
	// story must already be saved for its membership to change.

	/** Set a saved story's collection membership wholesale (deduped). */
	const setStoryCollections = useCallback(
		(storyId: string, ids: string[]) => {
			setSaved((prev) =>
				prev.map((s) =>
					s.storyId === storyId ? { ...s, collections: [...new Set(ids)] } : s,
				),
			);
		},
		[setSaved],
	);

	/** Add a saved story to a collection (no-op if not saved or already in it). */
	const addToCollection = useCallback(
		(storyId: string, colId: string) => {
			setSaved((prev) =>
				prev.map((s) =>
					s.storyId === storyId && !s.collections.includes(colId)
						? { ...s, collections: [...s.collections, colId] }
						: s,
				),
			);
		},
		[setSaved],
	);

	/** Remove a saved story from a collection. */
	const removeFromCollection = useCallback(
		(storyId: string, colId: string) => {
			setSaved((prev) =>
				prev.map((s) =>
					s.storyId === storyId
						? { ...s, collections: s.collections.filter((c) => c !== colId) }
						: s,
				),
			);
		},
		[setSaved],
	);

	/**
	 * Drop `colId` from every saved story's membership — the cross-store half of
	 * deleting a collection (collections.remove handles the tree). Saved stories
	 * are never removed, only un-tagged.
	 */
	const stripCollection = useCallback(
		(colId: string) => {
			setSaved((prev) =>
				prev.map((s) =>
					s.collections.includes(colId)
						? { ...s, collections: s.collections.filter((c) => c !== colId) }
						: s,
				),
			);
		},
		[setSaved],
	);

	/** Low-level bulk setter — used by the shared-collection import/merge. */
	const replaceAll = useCallback(
		(next: SavedStory[]) => {
			setSaved(next);
		},
		[setSaved],
	);

	return {
		saved,
		hydrated,
		isSaved,
		save,
		unsave,
		toggle,
		setStoryCollections,
		addToCollection,
		removeFromCollection,
		stripCollection,
		replaceAll,
	};
}
