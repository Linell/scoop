import { type Collection, childrenOf, descendantsOf } from "./collections";
import type { SavedStory } from "./saved";

/**
 * Publishing a collection — and importing one someone shared — is a best-effort
 * merge between two independent localStorage stores. A share carries a portable
 * snapshot of a subtree: its folders (with share-local keys, since the owner's
 * uuids mean nothing to the recipient) and the saved stories that live in them,
 * each tagged with the folder keys it belongs to. Importing walks that snapshot
 * against the recipient's existing tree, reusing folders that already match by
 * (parent, name) so a re-import doesn't duplicate, and unioning membership in.
 * Nothing is ever deleted. All three functions here are pure — ids, colors, and
 * the clock are injected so they're trivially testable.
 */

/** A share-local folder: `key` (f0..fn) is the portable id; `parent` is a key. */
export type ShareFolder = { key: string; name: string; parent: string | null };

/** A shared item: a story plus the folder keys it belongs to within the share. */
export type ShareItem = { storyId: string; folders: string[] };

/** The portable shape stored verbatim as a shared-list `structure`. */
export type ShareStructure = { folders: ShareFolder[]; items: ShareItem[] };

// Caps that bound a tampered or oversized share before we ever build the tree.
const MAX_FOLDERS = 500;
const MAX_ITEMS = 2000;
const MAX_NAME = 80;

/**
 * Build the publishable snapshot for `rootId`'s subtree. Folders are assigned
 * share-local keys f0..fn in a stable (descendants) order, with the root's own
 * parent pinned to null so the share stands alone. Items are every saved story
 * tagged into any folder in the subtree, each carrying its membership ∩ subtree
 * mapped to those keys. `ids` is the deduped story-id list (the shared-list's
 * ordered items), in the order the items appear.
 */
export function buildShareStructure(
	collections: Collection[],
	saved: SavedStory[],
	rootId: string,
): { ids: string[]; structure: ShareStructure } {
	const subtree = descendantsOf(collections, rootId);

	// Local collection id → share-local key, in subtree order (root first).
	const subtreeCols = collections.filter((c) => subtree.has(c.id));
	const keyById = new Map<string, string>();
	subtreeCols.forEach((c, i) => {
		keyById.set(c.id, `f${i}`);
	});

	const folders: ShareFolder[] = subtreeCols.map((c) => ({
		key: keyById.get(c.id) as string,
		name: c.name,
		// The root's parent is pinned to null; everything else maps its parent's
		// local id to a key (a parent outside the subtree can't happen for a
		// well-formed tree, but map-miss → null keeps the share self-contained).
		parent:
			c.id === rootId
				? null
				: c.parent
					? (keyById.get(c.parent) ?? null)
					: null,
	}));

	const ids: string[] = [];
	const items: ShareItem[] = [];
	for (const s of saved) {
		const inSubtree = s.collections.filter((id) => subtree.has(id));
		if (inSubtree.length === 0) continue;
		items.push({
			storyId: s.storyId,
			folders: inSubtree.map((id) => keyById.get(id) as string),
		});
		ids.push(s.storyId);
	}

	return { ids, structure: { folders, items } };
}

/**
 * Shape-validate a stored `structure` JSON string into a ShareStructure, or
 * null if it isn't one. Bounds the folder/item counts, truncates names, drops
 * folders whose parent key is unknown or would form a cycle, and keeps only
 * items that reference surviving folder keys. Defensive: a shared list's
 * structure is attacker-influenced text, so nothing here trusts its shape.
 */
export function parseShareStructure(
	json: string | null,
): ShareStructure | null {
	if (!json) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;
	const obj = parsed as { folders?: unknown; items?: unknown };
	if (!Array.isArray(obj.folders) || !Array.isArray(obj.items)) return null;

	// First pass: well-formed folder records, capped and name-truncated.
	const raw = (obj.folders as unknown[])
		.slice(0, MAX_FOLDERS)
		.filter(
			(f): f is ShareFolder =>
				!!f &&
				typeof (f as ShareFolder).key === "string" &&
				typeof (f as ShareFolder).name === "string" &&
				((f as ShareFolder).parent === null ||
					typeof (f as ShareFolder).parent === "string"),
		)
		.map((f) => ({
			key: f.key,
			name: f.name.trim().slice(0, MAX_NAME),
			parent: f.parent,
		}))
		.filter((f) => f.name.length > 0);

	// Drop folders whose parent ref is unknown or cyclic to root: walk each
	// folder's parent chain; keep it only if the chain reaches a null parent
	// without revisiting a key (a cycle) or hitting a missing parent.
	const byKey = new Map(raw.map((f) => [f.key, f]));
	const reachesRoot = (start: ShareFolder): boolean => {
		const seen = new Set<string>();
		let cur: ShareFolder | undefined = start;
		while (cur) {
			if (cur.parent === null) return true;
			if (seen.has(cur.key)) return false; // cycle
			seen.add(cur.key);
			cur = byKey.get(cur.parent);
		}
		return false; // unknown parent ref
	};
	const folders = raw.filter(reachesRoot);
	const keptKeys = new Set(folders.map((f) => f.key));

	const items = (obj.items as unknown[])
		.slice(0, MAX_ITEMS)
		.filter(
			(i): i is ShareItem =>
				!!i &&
				typeof (i as ShareItem).storyId === "string" &&
				Array.isArray((i as ShareItem).folders),
		)
		.map((i) => ({
			storyId: i.storyId,
			folders: i.folders.filter(
				(k): k is string => typeof k === "string" && keptKeys.has(k),
			),
		}))
		// Every legitimately-shared item carries ≥1 subtree folder (see
		// buildShareStructure), so an item left with no surviving folders comes
		// from a corrupted share. Drop it here so the parsed structure is exactly
		// what both the grouped preview (renders via folders.includes) and the
		// import act on — otherwise the preview hides it but the import keeps it.
		.filter((i) => i.folders.length > 0);

	return { folders, items };
}

/**
 * Best-effort merge of a parsed share into the recipient's stores. Walks the
 * incoming folders parents-first, mapping each share-local key to a local
 * collection id: if the mapped parent already has a child with the same name
 * (case-insensitive, trimmed) we reuse it (merge into it); otherwise we mint a
 * fresh Collection. Then for each item: ensure the story is saved (preserving
 * an existing savedAt) and union the mapped local collection ids into its
 * membership. Purely additive — never deletes a folder, story, or tag. `newId`
 * and `nextColor` are injected so the merge is deterministic in tests.
 */
export function mergeSharedCollection({
	structure,
	collections,
	saved,
	newId,
	nextColor,
	now,
}: {
	structure: ShareStructure;
	collections: Collection[];
	saved: SavedStory[];
	newId: () => string;
	nextColor: (count: number) => string;
	now: number;
}): { collections: Collection[]; saved: SavedStory[] } {
	const nextCollections = [...collections];
	// shareKey → local collection id, filled in parents-first below.
	const keyToLocal = new Map<string, string>();
	// Only PRE-EXISTING collections are reuse candidates for name-matching. A
	// folder minted earlier in this very sweep must never be reused — otherwise
	// two distinct incoming siblings with the same name would collapse into one.
	// Re-import dedupe still works: a prior import's folders are pre-existing.
	const preexistingIds = new Set(collections.map((c) => c.id));

	// Topologically order incoming folders so a folder is processed only after
	// its parent already has a local id. Roots (parent null) come first; we
	// re-sweep until everything resolvable is placed (a folder whose parent we
	// can't resolve — shouldn't happen post-parse — is simply skipped).
	const pending = [...structure.folders];
	let progressed = true;
	while (pending.length > 0 && progressed) {
		progressed = false;
		for (let i = pending.length - 1; i >= 0; i--) {
			const folder = pending[i];
			const parentResolved =
				folder.parent === null || keyToLocal.has(folder.parent);
			if (!parentResolved) continue;

			const parentLocal =
				folder.parent === null
					? null
					: (keyToLocal.get(folder.parent) as string);

			// Match against existing children of the mapped parent by name
			// (case-insensitive, trimmed). Incoming roots match existing roots.
			const wanted = folder.name.trim().toLowerCase();
			const existing = childrenOf(nextCollections, parentLocal).find(
				(c) =>
					preexistingIds.has(c.id) && c.name.trim().toLowerCase() === wanted,
			);

			if (existing) {
				keyToLocal.set(folder.key, existing.id);
			} else {
				const id = newId();
				nextCollections.push({
					id,
					name: folder.name,
					parent: parentLocal,
					color: nextColor(nextCollections.length),
				});
				keyToLocal.set(folder.key, id);
			}

			pending.splice(i, 1);
			progressed = true;
		}
	}

	// Map each item's share keys to the local ids we just resolved.
	const nextSaved = [...saved];
	const savedIndex = new Map(nextSaved.map((s, i) => [s.storyId, i]));
	for (const item of structure.items) {
		const localIds = item.folders
			.map((k) => keyToLocal.get(k))
			.filter((id): id is string => !!id);

		let idx = savedIndex.get(item.storyId);
		if (idx === undefined) {
			idx = nextSaved.length;
			nextSaved.push({ storyId: item.storyId, savedAt: now, collections: [] });
			savedIndex.set(item.storyId, idx);
		}
		const current = nextSaved[idx];
		const merged = new Set(current.collections);
		for (const id of localIds) merged.add(id);
		nextSaved[idx] = { ...current, collections: [...merged] };
	}

	return { collections: nextCollections, saved: nextSaved };
}
