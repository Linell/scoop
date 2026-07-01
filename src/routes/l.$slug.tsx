import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Check, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ScoopLogo } from "#/components/scoop-logo";
import { Button } from "#/components/ui/button";
import { voodooLoginUrl } from "#/lib/auth";
import { useCollections } from "#/lib/collections";
import { FLAVORS, flavorForFeed } from "#/lib/flavor";
import {
	mergeSharedCollection,
	parseShareStructure,
	type ShareStructure,
} from "#/lib/share-merge";
import type { Story } from "#/lib/types";
import { useSession } from "#/lib/use-session";
import type { ListResult } from "#/server/feeds";
import {
	getList,
	getMySavedEntries,
	getMySubscriptions,
	recordStorySave,
	subscribeFeed,
	updateSavedCollections,
} from "#/server/feeds";

export const Route = createFileRoute("/l/$slug")({
	// Fetch on the server so the preview is there on first paint.
	loader: ({ params }) => getList({ data: params.slug }),
	head: ({ loaderData }) => {
		const title = loaderData?.title ?? "Shared flavors";
		const full = `${title} — Scoop`;
		// Override the social-preview title so a shared link unfurls with the
		// list's own name; the image/description fall through to the root defaults.
		return {
			meta: [
				{ title: full },
				{ property: "og:title", content: full },
				{ name: "twitter:title", content: full },
			],
		};
	},
	component: ListPage,
});

function ListPage() {
	const list = Route.useLoaderData();

	if (!list) return <NotFoundCard />;
	if (list.kind === "stories") return <ReadingList list={list} />;
	return <FeedsList list={list} />;
}

/** A whip-card shell shared by every state on this page. */
function ListShell({ children }: { children: React.ReactNode }) {
	return (
		<main
			id="main-content"
			className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-2xl flex-col items-center justify-center px-4 py-12"
		>
			<article className="whip-card melt-in w-full overflow-hidden">
				<div
					className="flavor-band h-2 w-full"
					style={{ "--flavor": "var(--strawberry)" } as React.CSSProperties}
				/>
				<div className="flex flex-col gap-5 p-6 sm:p-8">{children}</div>
			</article>
		</main>
	);
}

function FeedsList({ list }: { list: Extract<ListResult, { kind: "feeds" }> }) {
	const router = useRouter();
	const session = useSession();
	const [mySubs, setMySubs] = useState<Set<string> | null>(null);
	const [added, setAdded] = useState(false);

	const feeds = list.items;
	const title = list.title ?? "Shared flavors";

	// Only worth knowing which feeds are already followed once signed in — a
	// signed-out visitor can't follow anything yet, so this only fetches then.
	useEffect(() => {
		if (!session) return;
		let cancelled = false;
		getMySubscriptions()
			.then((subs) => {
				if (!cancelled) setMySubs(new Set(subs.map((s) => s.feedId)));
			})
			.catch(() => {
				// A failed lookup unblocks the button the same as "none known yet".
				if (!cancelled) setMySubs(new Set());
			});
		return () => {
			cancelled = true;
		};
	}, [session]);

	const addAll = () => {
		// Subscribing now requires a session — send the visitor to sign in with
		// `next` pointing back at this exact list so the import completes
		// naturally once voodoo hands them back here.
		if (!session) {
			window.location.href = voodooLoginUrl(window.location.pathname);
			return;
		}
		if (!mySubs) return;
		const toAdd: { id: string; flavor: string }[] = [];
		let nextSize = mySubs.size;
		for (const feed of feeds) {
			if (mySubs.has(feed.id)) continue;
			toAdd.push({ id: feed.id, flavor: FLAVORS[nextSize % FLAVORS.length] });
			nextSize++;
		}
		setMySubs((prev) => new Set([...(prev ?? []), ...toAdd.map((f) => f.id)]));
		for (const { id, flavor } of toAdd) {
			subscribeFeed({ data: { feedId: id, flavor } }).catch(() => {});
		}
		setAdded(true);
		router.navigate({ to: "/" });
	};

	// How many of these the recipient doesn't already follow — drives the label.
	// Signed-out (mySubs === null) reads as "none followed yet" for the label.
	const newCount = feeds.filter((f) => !mySubs?.has(f.id)).length;
	const ready = !session || mySubs != null;

	return (
		<ListShell>
			<div className="flex items-center gap-3">
				<ScoopLogo className="h-10 w-10 shrink-0" />
				<div className="min-w-0">
					<p className="kicker">A scoop of flavors</p>
					<h1 className="scoop-title truncate text-2xl text-foreground sm:text-3xl">
						{title}
					</h1>
				</div>
			</div>

			{feeds.length === 0 ? (
				<p className="text-cocoa-soft">
					This list is empty — its flavors may have melted away.
				</p>
			) : (
				<ul className="flex flex-col gap-1">
					{feeds.map((feed) => (
						<li key={feed.id} className="flex items-center gap-3 py-1.5">
							<span
								className="flavor-dot shrink-0"
								style={
									{
										"--flavor": flavorForFeed(feed.id),
									} as React.CSSProperties
								}
							/>
							<span className="truncate text-foreground text-sm">
								{feed.title}
							</span>
						</li>
					))}
				</ul>
			)}

			{feeds.length > 0 ? (
				<Button
					onClick={addAll}
					disabled={added || !ready}
					className="rounded-full"
				>
					{added ? (
						<>
							<Check className="size-4" aria-hidden />
							Added!
						</>
					) : !session ? (
						"Sign in to add these flavors"
					) : (
						<>
							<Plus className="size-4" aria-hidden />
							{newCount === feeds.length
								? "Add all to my flavors"
								: newCount === 0
									? "Open my flavors"
									: `Add ${newCount} new to my flavors`}
						</>
					)}
				</Button>
			) : null}
		</ListShell>
	);
}

/**
 * A reading list (kind 'stories'): a read-only preview of someone's shared
 * collection. If a folder `structure` came along, we group the stories under
 * their folder names (nested by depth); otherwise it's a flat list. "Add to my
 * reading list" merges the folders into the recipient's local collection tree
 * and persists each story's save + collection membership to their account.
 */
function ReadingList({
	list,
}: {
	list: Extract<ListResult, { kind: "stories" }>;
}) {
	const router = useRouter();
	const session = useSession();
	const {
		collections,
		hydrated: collectionsHydrated,
		replaceAll: replaceCollections,
	} = useCollections();
	const [mySaved, setMySaved] = useState<
		{ storyId: string; savedAt: number; collections: string[] }[] | null
	>(null);
	const [added, setAdded] = useState(false);
	const [importFailed, setImportFailed] = useState(false);

	const stories = list.items;
	const title = list.title ?? "Shared reading list";

	// Only worth knowing the recipient's existing saves once signed in.
	useEffect(() => {
		if (!session) return;
		let cancelled = false;
		getMySavedEntries()
			.then((entries) => {
				if (!cancelled) setMySaved(entries);
			})
			.catch(() => {
				// A failed lookup unblocks the button the same as "nothing saved yet".
				if (!cancelled) setMySaved([]);
			});
		return () => {
			cancelled = true;
		};
	}, [session]);

	// The collection tree must have hydrated from localStorage before we merge
	// folders in, or we'd merge against the empty [] fallback and (harmlessly,
	// since replaceAll only ever adds) still risk a duplicate on a fast re-click.
	const ready = collectionsHydrated && (!session || mySaved != null);

	// Parse the folder structure once; null falls back to a flat list.
	const structure = useMemo(
		() => parseShareStructure(list.structure),
		[list.structure],
	);

	const addAll = async () => {
		if (!session) {
			// `next` points back at this exact shared-list URL, so the import
			// completes naturally once voodoo hands the reader back here signed in.
			window.location.href = voodooLoginUrl(window.location.pathname);
			return;
		}
		function sameCollections(a: string[], b: string[]): boolean {
			if (a.length !== b.length) return false;
			const setA = new Set(a);
			return b.every((c) => setA.has(c));
		}
		if (!ready || !mySaved) return;

		setImportFailed(false);

		const savedAsEntries = mySaved.map((s) => ({
			storyId: s.storyId,
			savedAt: s.savedAt,
			collections: s.collections,
		}));

		const pending: Promise<unknown>[] = [];

		if (structure) {
			// Merge the folders into the local tree and the stories into the local
			// "saved" shape (mergeSharedCollection is a pure, localStorage-shaped
			// helper); then persist each touched story's save + membership.
			const merged = mergeSharedCollection({
				structure,
				collections,
				saved: savedAsEntries,
				newId: () => crypto.randomUUID(),
				nextColor: (count) => FLAVORS[count % FLAVORS.length],
				now: Date.now(),
			});
			replaceCollections(merged.collections);
			const before = new Map(savedAsEntries.map((s) => [s.storyId, s]));
			for (const entry of merged.saved) {
				const prior = before.get(entry.storyId);
				if (prior && sameCollections(prior.collections, entry.collections)) {
					continue; // untouched by this import
				}
				if (!prior) {
					pending.push(
						recordStorySave({ data: { storyId: entry.storyId } }).then(() =>
							updateSavedCollections({
								data: {
									storyId: entry.storyId,
									collections: entry.collections,
								},
							}),
						),
					);
				} else {
					pending.push(
						updateSavedCollections({
							data: { storyId: entry.storyId, collections: entry.collections },
						}),
					);
				}
			}
		} else {
			// No structure — just save the bare stories (preserving existing saves).
			const existing = new Set(savedAsEntries.map((s) => s.storyId));
			for (const s of stories) {
				if (existing.has(s.id)) continue;
				pending.push(recordStorySave({ data: { storyId: s.id } }));
			}
		}

		const results = await Promise.allSettled(pending);
		if (results.some((r) => r.status === "rejected")) {
			setImportFailed(true);
			return;
		}
		setAdded(true);
		router.navigate({ to: "/saved" });
	};

	return (
		<ListShell>
			<div className="flex items-center gap-3">
				<ScoopLogo className="h-10 w-10 shrink-0" />
				<div className="min-w-0">
					<p className="kicker">A reading list</p>
					<h1 className="scoop-title truncate text-2xl text-foreground sm:text-3xl">
						{title}
					</h1>
				</div>
			</div>

			{stories.length === 0 ? (
				<p className="text-cocoa-soft">
					This list is empty — its scoops may have melted away.
				</p>
			) : structure ? (
				<GroupedStories structure={structure} stories={stories} />
			) : (
				<ul className="flex flex-col gap-2">
					{stories.map((story) => (
						<StoryRow key={story.id} story={story} />
					))}
				</ul>
			)}

			{stories.length > 0 ? (
				<div className="flex flex-col items-start gap-2">
					<Button
						onClick={addAll}
						disabled={added || (!!session && !ready)}
						className="rounded-full"
					>
						{added ? (
							<>
								<Check className="size-4" aria-hidden />
								Added!
							</>
						) : !session ? (
							"Sign in to add this list"
						) : !ready ? (
							"Churning…"
						) : (
							<>
								<Plus className="size-4" aria-hidden />
								Add to my reading list
							</>
						)}
					</Button>
					{importFailed ? (
						<p role="alert" className="text-sm text-strawberry-ink">
							Some flavors failed to save — try again.
						</p>
					) : null}
				</div>
			) : null}
		</ListShell>
	);
}

/** A single story line in a shared reading-list preview. Colored by the story's
 * feed (stable hash) so it matches the same story's flavor on /saved. */
function StoryRow({ story }: { story: Story }) {
	return (
		<li className="flex items-center gap-3 py-1">
			<span
				className="flavor-dot shrink-0"
				style={
					{ "--flavor": flavorForFeed(story.feedId) } as React.CSSProperties
				}
			/>
			<span className="truncate text-foreground text-sm">{story.title}</span>
		</li>
	);
}

/**
 * Stories grouped under their folder names, nested by depth. We walk the
 * structure's folders parent-first into a depth-indexed render, listing each
 * folder's directly-tagged stories beneath its heading. Stories tagged into
 * multiple folders appear under each (the preview mirrors the membership).
 */
function GroupedStories({
	structure,
	stories,
}: {
	structure: ShareStructure;
	stories: Story[];
}) {
	const storyById = useMemo(
		() => new Map(stories.map((s) => [s.id, s])),
		[stories],
	);

	// Depth-first pre-order over the folder forest (roots first), so headings
	// indent the way the owner's tree nested. parseShareStructure already
	// guarantees every folder's parent resolves to a root without cycles.
	const rows = useMemo(() => {
		const byParent = new Map<string | null, ShareStructure["folders"]>();
		for (const f of structure.folders) {
			const list = byParent.get(f.parent) ?? [];
			list.push(f);
			byParent.set(f.parent, list);
		}
		// Invert membership in one pass (folderKey → storyIds) so each folder reads
		// its stories in O(1) instead of re-scanning every item — at the parse caps
		// (500 folders × 2000 items) the per-folder filter was ~1M scans on SSR.
		const idsByFolder = new Map<string, string[]>();
		for (const item of structure.items) {
			for (const key of item.folders) {
				const list = idsByFolder.get(key) ?? [];
				list.push(item.storyId);
				idsByFolder.set(key, list);
			}
		}
		const out: {
			key: string;
			name: string;
			depth: number;
			storyIds: string[];
		}[] = [];
		const walk = (parent: string | null, depth: number) => {
			for (const folder of byParent.get(parent) ?? []) {
				const storyIds = idsByFolder.get(folder.key) ?? [];
				out.push({ key: folder.key, name: folder.name, depth, storyIds });
				walk(folder.key, depth + 1);
			}
		};
		walk(null, 0);
		return out;
	}, [structure]);

	return (
		<div className="flex flex-col gap-4">
			{rows.map((row) => (
				<div key={row.key} style={{ marginLeft: `${row.depth * 0.85}rem` }}>
					<h2 className="kicker mb-1.5">{row.name}</h2>
					{row.storyIds.length === 0 ? (
						<p className="text-cocoa-soft text-sm italic">Empty</p>
					) : (
						<ul className="flex flex-col gap-1.5">
							{row.storyIds.map((id) => {
								const story = storyById.get(id);
								if (!story) return null;
								return <StoryRow key={id} story={story} />;
							})}
						</ul>
					)}
				</div>
			))}
		</div>
	);
}

function NotFoundCard() {
	return (
		<ListShell>
			<div className="flex flex-col items-center gap-3 text-center">
				<ScoopLogo className="h-10 w-10 opacity-70 grayscale" />
				<p className="max-w-[44ch] text-cocoa-soft">
					We couldn't find that list — it may have melted away.
				</p>
			</div>
		</ListShell>
	);
}
