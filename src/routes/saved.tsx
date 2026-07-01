import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import {
	ArrowRight,
	Bookmark,
	Check,
	FolderPlus,
	Pencil,
	Plus,
	Share2,
	Sparkles,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScoopCard } from "#/components/scoop-card";
import { ScoopLogo } from "#/components/scoop-logo";
import { ShareDialog } from "#/components/share-dialog";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { voodooLoginUrl } from "#/lib/auth";
import {
	type Collection,
	childrenOf,
	descendantsOf,
	roots,
	useCollections,
} from "#/lib/collections";
import { useFeedView } from "#/lib/feed-view";
import { FLAVORS, flavorForFeed } from "#/lib/flavor";
import { buildShareStructure } from "#/lib/share-merge";
import type { Feed, Story } from "#/lib/types";
import {
	createList,
	getFeeds,
	getMySavedEntries,
	getSavedStories,
	recordStorySave,
	removeStorySave,
	updateSavedCollections,
} from "#/server/feeds";

export const Route = createFileRoute("/saved")({
	beforeLoad: ({ context, location }) => {
		if (!context.user) {
			throw redirect({ href: voodooLoginUrl(location.href) });
		}
	},
	loader: async () => {
		const [entries, stories] = await Promise.all([
			getMySavedEntries(),
			getSavedStories(),
		]);
		const feedIds = [...new Set(stories.map((s) => s.feedId))];
		const feeds = feedIds.length ? await getFeeds({ data: feedIds }) : [];
		return { entries, stories, feeds };
	},
	component: SavedPage,
});

/** A saved story's local membership record — mirrors the server row shape
 *  (server/db.ts's user_saved_stories), minus the story payload itself. */
type SavedEntry = { storyId: string; savedAt: number; collections: string[] };

/**
 * A collection laid out as a flattened tree row: the node plus its depth, so the
 * sidebar can indent without recursing in JSX. Roots-first, children after each
 * parent (a depth-first pre-order walk), guarding against cycles.
 */
type TreeRow = { collection: Collection; depth: number };
function flattenTree(collections: Collection[]): TreeRow[] {
	const out: TreeRow[] = [];
	const seen = new Set<string>();
	const walk = (node: Collection, depth: number) => {
		if (seen.has(node.id)) return; // cycle guard
		seen.add(node.id);
		out.push({ collection: node, depth });
		for (const child of childrenOf(collections, node.id))
			walk(child, depth + 1);
	};
	for (const root of roots(collections)) walk(root, 0);
	return out;
}

function SavedPage() {
	const {
		entries: initialEntries,
		stories: initialStories,
		feeds: initialFeeds,
	} = Route.useLoaderData();

	// The collection tree is still a local (per-browser) concept — see
	// collections.ts — but the saved stories themselves (and their per-story
	// `collections` tags) are server rows now, seeded from the loader.
	const {
		collections,
		hydrated: collectionsHydrated,
		create,
		rename,
		remove,
	} = useCollections();

	const [saved, setSaved] = useState<SavedEntry[]>(initialEntries);
	const [stories, setStories] = useState<Story[]>(initialStories);
	const [feeds, setFeeds] = useState<Feed[]>(initialFeeds);
	const { view } = useFeedView();

	// Which collection the grid is focused on. null = "All saved". Local state —
	// a transient view choice, no need to survive reloads.
	const [activeId, setActiveId] = useState<string | null>(null);
	// The collection whose share dialog is open (its name titles the link).
	const [shareCol, setShareCol] = useState<Collection | null>(null);

	const isSaved = useCallback(
		(id: string) => saved.some((s) => s.storyId === id),
		[saved],
	);

	// Delete a collection: drop the folder (re-parenting its children) locally,
	// and strip its tag off every saved story server-side so the two never desync.
	const deleteCollection = useCallback(
		(id: string) => {
			remove(id);
			const affected = saved.filter((s) => s.collections.includes(id));
			setSaved((prev) =>
				prev.map((s) =>
					s.collections.includes(id)
						? { ...s, collections: s.collections.filter((c) => c !== id) }
						: s,
				),
			);
			for (const s of affected) {
				const next = s.collections.filter((c) => c !== id);
				updateSavedCollections({
					data: { storyId: s.storyId, collections: next },
				}).catch(() => {});
			}
		},
		[remove, saved],
	);

	// Saved ids, newest-first — the order the grid renders in.
	const ids = useMemo(
		() =>
			[...saved].sort((a, b) => b.savedAt - a.savedAt).map((s) => s.storyId),
		[saved],
	);

	// Refresh the saved stories (and the feeds they belong to) if `saved` ever
	// names an id we don't have hydrated — every save on this page toggles an
	// already-rendered story, so in practice this only guards the rare case of a
	// save landing from elsewhere. Tracks the missing-id set it already tried so a
	// story that genuinely can't be resolved doesn't refetch every render.
	const triedMissing = useRef<string>("");
	useEffect(() => {
		const missing = ids.filter((id) => !stories.some((s) => s.id === id));
		const key = missing.join(",");
		if (missing.length === 0 || key === triedMissing.current) return;
		triedMissing.current = key;
		let cancelled = false;
		getSavedStories().then(async (s) => {
			if (cancelled) return;
			setStories(s);
			const feedIds = [...new Set(s.map((story) => story.feedId))];
			const f = feedIds.length ? await getFeeds({ data: feedIds }) : [];
			if (!cancelled) setFeeds(f);
		});
		return () => {
			cancelled = true;
		};
	}, [ids, stories]);

	const feedById = useMemo(() => new Map(feeds.map((f) => [f.id, f])), [feeds]);
	const storyById = useMemo(
		() => new Map(stories.map((s) => [s.id, s])),
		[stories],
	);
	const membershipById = useMemo(
		() => new Map(saved.map((s) => [s.storyId, s.collections])),
		[saved],
	);

	// If the focused collection is deleted out from under us, fall back to "All".
	useEffect(() => {
		if (activeId && !collections.some((c) => c.id === activeId)) {
			setActiveId(null);
		}
	}, [activeId, collections]);

	// The set of collection ids the active filter accepts: the selection ∪ its
	// descendants (same set-filter spirit as useFeedFilter). null = accept all.
	const acceptedCollections = useMemo(
		() => (activeId ? descendantsOf(collections, activeId) : null),
		[activeId, collections],
	);

	// Render in saved order (newest-first), keeping only hydrated ids, and — when
	// a collection is focused — only stories whose membership intersects it.
	const ordered = useMemo(() => {
		const hydrate = ids
			.map((id) => storyById.get(id))
			.filter((s): s is Story => !!s);
		if (!acceptedCollections) return hydrate;
		return hydrate.filter((s) =>
			(membershipById.get(s.id) ?? []).some((c) => acceptedCollections.has(c)),
		);
	}, [ids, storyById, acceptedCollections, membershipById]);

	const tree = useMemo(() => flattenTree(collections), [collections]);
	const activeCollection = useMemo(
		() => collections.find((c) => c.id === activeId) ?? null,
		[collections, activeId],
	);

	// The share link mints from the *current* collections/saved at click time, but
	// the callback must stay stable on the share target alone — otherwise every
	// save/edit (or a cross-tab storage event) churns these arrays, changing the
	// callback identity and re-firing ShareDialog's effect, which inserts a fresh
	// shared_lists row and orphans any slug the user already copied. Read the
	// latest values through refs so the callback can depend on [shareCol] only.
	const collectionsRef = useRef(collections);
	collectionsRef.current = collections;
	const savedRef = useRef(saved);
	savedRef.current = saved;

	// Save handler shared by every card on this page (see ScoopCard, now
	// presentational). Saving/unsaving are both durable server writes now — no
	// more purely-local unsave.
	const onToggleSave = useCallback(
		(storyId: string) => {
			const wasSaved = isSaved(storyId);
			if (wasSaved) {
				const removed = savedRef.current.find((s) => s.storyId === storyId);
				setSaved((prev) => prev.filter((s) => s.storyId !== storyId));
				removeStorySave({ data: storyId }).catch(() => {
					if (removed) setSaved((prev) => [...prev, removed]);
				});
			} else {
				setSaved((prev) => [
					...prev,
					{ storyId, savedAt: Date.now(), collections: [] },
				]);
				recordStorySave({ data: { storyId } }).catch(() => {
					setSaved((prev) => prev.filter((s) => s.storyId !== storyId));
				});
			}
		},
		[isSaved],
	);

	// Add/remove a saved story's collection tag, optimistically, then persist the
	// full membership array server-side (updateSavedCollections overwrites it).
	const addToCollection = useCallback((storyId: string, colId: string) => {
		const prevEntry = savedRef.current.find((s) => s.storyId === storyId);
		setSaved((prev) => {
			const next = prev.map((s) =>
				s.storyId === storyId && !s.collections.includes(colId)
					? { ...s, collections: [...s.collections, colId] }
					: s,
			);
			const entry = next.find((s) => s.storyId === storyId);
			if (entry) {
				updateSavedCollections({
					data: { storyId, collections: entry.collections },
				}).catch(() => {
					if (prevEntry) {
						setSaved((cur) =>
							cur.map((s) => (s.storyId === storyId ? prevEntry : s)),
						);
					}
				});
			}
			return next;
		});
	}, []);

	const removeFromCollection = useCallback((storyId: string, colId: string) => {
		const prevEntry = savedRef.current.find((s) => s.storyId === storyId);
		setSaved((prev) => {
			const next = prev.map((s) =>
				s.storyId === storyId
					? { ...s, collections: s.collections.filter((c) => c !== colId) }
					: s,
			);
			const entry = next.find((s) => s.storyId === storyId);
			if (entry) {
				updateSavedCollections({
					data: { storyId, collections: entry.collections },
				}).catch(() => {
					if (prevEntry) {
						setSaved((cur) =>
							cur.map((s) => (s.storyId === storyId ? prevEntry : s)),
						);
					}
				});
			}
			return next;
		});
	}, []);

	// Publish the focused (or share-targeted) collection's subtree as a shared
	// stories list and resolve to its /l/<slug> link. Memoized on the share
	// target so the ShareDialog only re-mints when the targeted collection changes.
	const createCollectionLink = useCallback(async (): Promise<string> => {
		if (!shareCol) throw new Error("No collection to share.");
		const { ids: storyIds, structure } = buildShareStructure(
			collectionsRef.current,
			savedRef.current,
			shareCol.id,
		);
		if (storyIds.length === 0) {
			throw new Error("This collection has no saved scoops to share yet.");
		}
		const { slug } = await createList({
			data: {
				kind: "stories",
				title: shareCol.name,
				ids: storyIds,
				structure: JSON.stringify(structure),
			},
		});
		return `${window.location.origin}/l/${slug}`;
	}, [shareCol]);

	const showSkeletons = !collectionsHydrated;

	return (
		<main id="main-content" className="mx-auto w-full max-w-6xl px-4 pb-24">
			<section className="melt-in py-10 sm:py-14">
				<p className="kicker">Saved for later</p>
				<h1 className="scoop-title mt-3 text-[2rem] text-foreground sm:text-6xl">
					Your reading list
				</h1>
			</section>

			<div className="grid gap-8 lg:grid-cols-[240px_1fr]">
				{/* Collections sidebar — mirrors the home page's "Your flavors" aside. */}
				<aside className="lg:sticky lg:top-20 lg:self-start">
					<div className="flex items-center justify-between">
						<h2 className="kicker">Your collections</h2>
						<span className="text-xs text-cocoa-soft">
							{collectionsHydrated ? collections.length : ""}
						</span>
					</div>

					{!collectionsHydrated ? (
						<CollectionListSkeleton />
					) : (
						<CollectionTree
							tree={tree}
							savedCount={saved.length}
							activeId={activeId}
							onSelect={setActiveId}
							onCreate={create}
							onRename={rename}
							onDelete={(id) => {
								if (activeId === id) setActiveId(null);
								deleteCollection(id);
							}}
							onShare={(c) => setShareCol(c)}
						/>
					)}

					<NewCollectionButton
						hydrated={collectionsHydrated}
						parent={activeCollection}
						onCreate={(name, parent) => setActiveId(create(name, parent))}
					/>
				</aside>

				{/* The grid */}
				<section>
					{collectionsHydrated && activeCollection ? (
						<div className="mb-4 flex items-center gap-2">
							<button
								type="button"
								onClick={() => setActiveId(null)}
								style={
									{ "--flavor": activeCollection.color } as React.CSSProperties
								}
								className="flavor-chip focus-scoop"
								aria-label={`Showing ${activeCollection.name}. Clear filter.`}
								title="Clear filter"
							>
								<span className="flavor-chip__dots shrink-0">
									<span className="flavor-dot" />
								</span>
								<span className="truncate">{activeCollection.name}</span>
								<span className="flavor-chip__x shrink-0" aria-hidden="true">
									<X className="size-3" />
								</span>
							</button>
						</div>
					) : null}

					{/* Announce loading → loaded → empty transitions. */}
					<div aria-live="polite" aria-busy={showSkeletons}>
						{showSkeletons ? (
							<div className="grid gap-5 sm:grid-cols-2">
								<output className="sr-only">Loading your saved scoops…</output>
								{FLAVORS.map((flavor, i) => (
									<ScoopCardSkeleton key={flavor} flavor={flavor} index={i} />
								))}
							</div>
						) : ordered.length === 0 ? (
							activeCollection ? (
								<EmptyCollection name={activeCollection.name} />
							) : (
								<EmptySaved />
							)
						) : (
							<div
								key={activeId ?? "all"}
								className="grid gap-5 sm:grid-cols-2"
							>
								{ordered.map((story, i) => (
									<SavedCard
										key={story.id}
										story={story}
										feed={feedById.get(story.feedId)}
										index={i}
										view={view}
										saved={isSaved(story.id)}
										onToggleSave={() => onToggleSave(story.id)}
										collections={collections}
										membership={membershipById.get(story.id) ?? []}
										onAdd={addToCollection}
										onRemove={removeFromCollection}
										onCreate={create}
									/>
								))}
							</div>
						)}
					</div>
				</section>
			</div>

			<ShareDialog
				open={shareCol !== null}
				onOpenChange={(next) => {
					if (!next) setShareCol(null);
				}}
				title={`Share "${shareCol?.name ?? ""}"`}
				description="Anyone with this link can add this collection — folders and all — to their own reading list."
				createLink={createCollectionLink}
			/>
		</main>
	);
}

/**
 * One saved story plus the controls to manage which collections it's in. The
 * card itself is the shared ScoopCard (untouched — collection UI would leak onto
 * the home feed); the collection affordances live underneath it here.
 */
function SavedCard({
	story,
	feed,
	index,
	view,
	saved,
	onToggleSave,
	collections,
	membership,
	onAdd,
	onRemove,
	onCreate,
}: {
	story: Story;
	feed: Feed | undefined;
	index: number;
	view: import("#/lib/feed-view").FeedView;
	saved: boolean;
	onToggleSave: () => void;
	collections: Collection[];
	membership: string[];
	onAdd: (storyId: string, colId: string) => void;
	onRemove: (storyId: string, colId: string) => void;
	onCreate: (name: string, parent?: string | null) => string;
}) {
	const inIds = useMemo(() => new Set(membership), [membership]);
	const tags = useMemo(
		() => collections.filter((c) => inIds.has(c.id)),
		[collections, inIds],
	);

	return (
		<div className="flex h-full flex-col gap-2">
			<ScoopCard
				story={story}
				feed={feed}
				flavor={flavorForFeed(story.feedId)}
				index={index}
				view={view}
				saved={saved}
				onToggleSave={onToggleSave}
			/>
			<div className="flex flex-wrap items-center gap-1.5 px-1">
				{tags.map((c) => (
					<span
						key={c.id}
						style={{ "--flavor": c.color } as React.CSSProperties}
						className="flavor-chip"
						title={c.name}
					>
						<span className="flavor-chip__dots shrink-0">
							<span className="flavor-dot" />
						</span>
						<span className="max-w-[10rem] truncate">{c.name}</span>
						<button
							type="button"
							onClick={() => onRemove(story.id, c.id)}
							aria-label={`Remove from ${c.name}`}
							className="flavor-chip__x shrink-0"
						>
							<X className="size-3" />
						</button>
					</span>
				))}
				<CollectionMenu
					story={story}
					collections={collections}
					inIds={inIds}
					onAdd={onAdd}
					onRemove={onRemove}
					onCreate={onCreate}
				/>
			</div>
		</div>
	);
}

/** A small popover: checkbox list of collections + inline "new collection". */
function CollectionMenu({
	story,
	collections,
	inIds,
	onAdd,
	onRemove,
	onCreate,
}: {
	story: Story;
	collections: Collection[];
	inIds: Set<string>;
	onAdd: (storyId: string, colId: string) => void;
	onRemove: (storyId: string, colId: string) => void;
	onCreate: (name: string, parent?: string | null) => string;
}) {
	const [open, setOpen] = useState(false);
	const [newName, setNewName] = useState("");
	const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));
	const tree = useMemo(() => flattenTree(collections), [collections]);

	const addNew = () => {
		const name = newName.trim();
		if (!name) return;
		const id = onCreate(name, null);
		onAdd(story.id, id);
		setNewName("");
	};

	return (
		<div className="relative" ref={ref}>
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
				aria-label="Add to a collection"
				className="focus-scoop inline-flex items-center gap-1 rounded-full border border-border border-dashed px-2.5 py-1 text-cocoa-soft text-xs transition-colors hover:border-strawberry hover:text-strawberry-ink"
			>
				<Plus className="size-3" aria-hidden />
				Collection
			</button>

			{open ? (
				<div className="absolute bottom-full left-0 z-20 mb-2 w-60 rounded-2xl border border-border bg-card p-2 shadow-lg">
					{tree.length > 0 ? (
						<ul className="max-h-56 space-y-0.5 overflow-y-auto">
							{tree.map(({ collection: c, depth }) => {
								const checked = inIds.has(c.id);
								return (
									<li key={c.id}>
										<button
											type="button"
											onClick={() =>
												checked
													? onRemove(story.id, c.id)
													: onAdd(story.id, c.id)
											}
											aria-pressed={checked}
											style={{ paddingLeft: `${0.5 + depth * 0.85}rem` }}
											className="focus-scoop flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-sm transition-colors hover:bg-secondary"
										>
											<span
												className={`flex size-4 shrink-0 items-center justify-center rounded border ${
													checked
														? "border-strawberry bg-strawberry text-card"
														: "border-border"
												}`}
											>
												{checked ? (
													<Check className="size-3" aria-hidden />
												) : null}
											</span>
											<span
												className="flavor-dot shrink-0"
												style={{ "--flavor": c.color } as React.CSSProperties}
											/>
											<span className="truncate text-foreground">{c.name}</span>
										</button>
									</li>
								);
							})}
						</ul>
					) : (
						<p className="px-2 py-1.5 text-cocoa-soft text-xs">
							No collections yet — make one below.
						</p>
					)}

					<div className="mt-1.5 flex items-center gap-1.5 border-border border-t pt-1.5">
						<input
							value={newName}
							onChange={(e) => setNewName(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") addNew();
							}}
							placeholder="New collection…"
							aria-label="New collection name"
							className="focus-scoop min-w-0 flex-1 rounded-full border border-border bg-card px-3 py-1.5 text-sm"
						/>
						<button
							type="button"
							onClick={addNew}
							disabled={!newName.trim()}
							aria-label="Create collection"
							className="focus-scoop inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-strawberry text-card disabled:opacity-40"
						>
							<Plus className="size-4" aria-hidden />
						</button>
					</div>
				</div>
			) : null}
		</div>
	);
}

/** The sidebar tree: "All saved" + each collection row, with row affordances. */
function CollectionTree({
	tree,
	savedCount,
	activeId,
	onSelect,
	onRename,
	onDelete,
	onShare,
}: {
	tree: TreeRow[];
	savedCount: number;
	activeId: string | null;
	onSelect: (id: string | null) => void;
	onCreate: (name: string, parent?: string | null) => string;
	onRename: (id: string, name: string) => void;
	onDelete: (id: string) => void;
	onShare: (c: Collection) => void;
}) {
	return (
		<ul className="mt-4 space-y-1">
			<li>
				<button
					type="button"
					onClick={() => onSelect(null)}
					aria-pressed={activeId === null}
					data-active={activeId === null}
					style={{ "--flavor": "var(--strawberry)" } as React.CSSProperties}
					className={`flavor-row focus-scoop flex min-h-11 w-full items-center gap-3 rounded-full px-3 py-2 text-left text-sm ${
						activeId === null
							? "font-semibold text-foreground"
							: "text-cocoa-soft"
					}`}
				>
					<Sparkles
						className="size-4 shrink-0 text-strawberry-ink"
						aria-hidden
					/>
					<span className="truncate">All saved</span>
					<span className="ml-auto shrink-0 text-cocoa-soft text-xs">
						{savedCount}
					</span>
				</button>
			</li>
			{tree.map(({ collection: c, depth }) => (
				<CollectionRow
					key={c.id}
					collection={c}
					depth={depth}
					active={activeId === c.id}
					onSelect={() => onSelect(c.id)}
					onRename={onRename}
					onDelete={onDelete}
					onShare={onShare}
				/>
			))}
		</ul>
	);
}

function CollectionRow({
	collection: c,
	depth,
	active,
	onSelect,
	onRename,
	onDelete,
	onShare,
}: {
	collection: Collection;
	depth: number;
	active: boolean;
	onSelect: () => void;
	onRename: (id: string, name: string) => void;
	onDelete: (id: string) => void;
	onShare: (c: Collection) => void;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(c.name);

	const commit = () => {
		const name = draft.trim();
		if (name && name !== c.name) onRename(c.id, name);
		else setDraft(c.name);
		setEditing(false);
	};

	if (editing) {
		return (
			<li style={{ paddingLeft: `${depth * 0.85}rem` }}>
				<input
					// biome-ignore lint/a11y/noAutofocus: focusing the rename field is the point
					autoFocus
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onBlur={commit}
					onKeyDown={(e) => {
						if (e.key === "Enter") commit();
						if (e.key === "Escape") {
							setDraft(c.name);
							setEditing(false);
						}
					}}
					aria-label={`Rename ${c.name}`}
					className="focus-scoop min-h-11 w-full rounded-full border border-border bg-card px-3 py-2 text-sm"
				/>
			</li>
		);
	}

	return (
		<li className="group/col" style={{ paddingLeft: `${depth * 0.85}rem` }}>
			<div
				data-active={active}
				style={{ "--flavor": c.color } as React.CSSProperties}
				className="flavor-row flex min-h-11 w-full items-center rounded-full pr-1"
			>
				<button
					type="button"
					onClick={onSelect}
					aria-pressed={active}
					aria-label={`Filter by ${c.name}`}
					className="focus-scoop flex min-w-0 flex-1 items-center gap-3 rounded-full px-3 py-2 text-left"
				>
					<span className="flavor-dot shrink-0" />
					<span
						title={c.name}
						className={`truncate text-sm ${
							active ? "font-semibold text-foreground" : "text-foreground"
						}`}
					>
						{c.name}
					</span>
				</button>
				<div className="flex shrink-0 items-center opacity-0 transition-opacity group-focus-within/col:opacity-100 group-hover/col:opacity-100">
					<button
						type="button"
						onClick={() => onShare(c)}
						aria-label={`Share ${c.name}`}
						className="focus-scoop rounded-full p-1 text-cocoa-soft hover:text-strawberry-ink"
					>
						<Share2 className="size-3.5" aria-hidden />
					</button>
					<button
						type="button"
						onClick={() => {
							setDraft(c.name);
							setEditing(true);
						}}
						aria-label={`Rename ${c.name}`}
						className="focus-scoop rounded-full p-1 text-cocoa-soft hover:text-strawberry-ink"
					>
						<Pencil className="size-3.5" aria-hidden />
					</button>
					<button
						type="button"
						onClick={() => onDelete(c.id)}
						aria-label={`Delete ${c.name}`}
						className="focus-scoop rounded-full p-1 text-cocoa-soft hover:text-strawberry-ink"
					>
						<Trash2 className="size-3.5" aria-hidden />
					</button>
				</div>
			</div>
		</li>
	);
}

/** "New collection" control — root by default, or under the focused collection. */
function NewCollectionButton({
	hydrated,
	parent,
	onCreate,
}: {
	hydrated: boolean;
	parent: Collection | null;
	onCreate: (name: string, parent: string | null) => void;
}) {
	const [adding, setAdding] = useState(false);
	const [name, setName] = useState("");

	if (!hydrated) {
		return (
			<div
				className="mt-2 h-9 w-full rounded-full bg-secondary/60"
				aria-hidden
			/>
		);
	}

	const commit = () => {
		const trimmed = name.trim();
		if (trimmed) onCreate(trimmed, parent?.id ?? null);
		setName("");
		setAdding(false);
	};

	if (adding) {
		return (
			<div className="mt-2 flex items-center gap-1.5">
				<input
					// biome-ignore lint/a11y/noAutofocus: opening the field is an explicit action
					autoFocus
					value={name}
					onChange={(e) => setName(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") commit();
						if (e.key === "Escape") {
							setName("");
							setAdding(false);
						}
					}}
					placeholder={
						parent ? `New list in ${parent.name}…` : "New collection…"
					}
					aria-label="New collection name"
					className="focus-scoop min-w-0 flex-1 rounded-full border border-border bg-card px-3 py-1.5 text-sm"
				/>
				<button
					type="button"
					onClick={commit}
					disabled={!name.trim()}
					aria-label="Create collection"
					className="focus-scoop inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-strawberry text-card disabled:opacity-40"
				>
					<Plus className="size-4" aria-hidden />
				</button>
			</div>
		);
	}

	return (
		<Button
			variant="ghost"
			onClick={() => setAdding(true)}
			className="mt-2 w-full justify-start rounded-full text-cocoa-soft"
		>
			<FolderPlus className="size-4" aria-hidden />
			{parent ? `New list in "${parent.name}"` : "New collection"}
		</Button>
	);
}

/** Dismiss a popover on an outside click or Escape. Returns a ref to attach. */
function useClickOutside<T extends HTMLElement>(onClose: () => void) {
	const ref = useRef<T>(null);
	useEffect(() => {
		const onDown = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) onClose();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [onClose]);
	return ref;
}

/** Nothing saved yet — a warm nudge back to the feed, in the site's voice. */
function EmptySaved() {
	return (
		<div className="whip-card flex flex-col items-center gap-5 p-8 text-center">
			<ScoopLogo className="h-10 w-10 opacity-70 grayscale" />
			<p className="max-w-[44ch] text-cocoa-soft">
				No scoops saved yet. Tap the bookmark on any story to set it aside for
				later — your reading list keeps it warm.
			</p>
			<Link
				to="/"
				className="focus-scoop inline-flex items-center gap-2 rounded-md font-semibold text-sm text-strawberry-ink no-underline"
			>
				Back to the feed
				<ArrowRight className="size-4" aria-hidden />
			</Link>
		</div>
	);
}

/** A focused collection with nothing in it yet. */
function EmptyCollection({ name }: { name: string }) {
	return (
		<div className="whip-card flex flex-col items-center gap-3 p-8 text-center">
			<Bookmark className="h-9 w-9 text-cocoa-soft opacity-70" aria-hidden />
			<p className="max-w-[44ch] text-cocoa-soft">
				Nothing in <span className="font-semibold text-foreground">{name}</span>{" "}
				yet — use the “Collection” button under any saved scoop to add it here.
			</p>
		</div>
	);
}

function CollectionListSkeleton() {
	const widths = ["68%", "50%", "60%"];
	return (
		<ul className="mt-4 space-y-1">
			{widths.map((w, i) => (
				<li key={w}>
					<div className="flex min-h-11 w-full items-center gap-3 rounded-full px-3 py-2">
						<span
							className="flavor-dot shrink-0"
							style={{ "--flavor": FLAVORS[i] } as React.CSSProperties}
						/>
						<Skeleton className="h-3.5 rounded-full" style={{ width: w }} />
					</div>
				</li>
			))}
		</ul>
	);
}

function ScoopCardSkeleton({
	flavor,
	index,
}: {
	flavor: string;
	index: number;
}) {
	return (
		<div
			className="whip-card melt-in flex h-full flex-col overflow-hidden text-left"
			style={{ animationDelay: `${index * 60}ms` }}
			aria-hidden="true"
		>
			<div
				className="flavor-band h-2 w-full"
				style={{ "--flavor": flavor } as React.CSSProperties}
			/>
			<div className="flex flex-1 flex-col gap-4 p-5">
				<div className="flex items-center gap-2">
					<span
						className="flavor-dot shrink-0"
						style={{ "--flavor": flavor } as React.CSSProperties}
					/>
					<Skeleton className="h-3 w-24 rounded-full" />
					<Skeleton className="ml-auto h-3 w-10 rounded-full" />
				</div>
				<div className="space-y-2">
					<Skeleton className="h-5 w-[92%] rounded-full" />
					<Skeleton className="h-5 w-[64%] rounded-full" />
				</div>
				<div className="space-y-2">
					<Skeleton className="h-3 w-full rounded-full" />
					<Skeleton className="h-3 w-full rounded-full" />
					<Skeleton className="h-3 w-[80%] rounded-full" />
				</div>
				<div className="mt-auto flex items-center gap-1.5 pt-1 font-semibold text-sm text-strawberry-ink">
					Read the full scoop
					<ArrowRight className="size-4" />
				</div>
			</div>
		</div>
	);
}
