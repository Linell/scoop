import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Check, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { ScoopLogo } from "#/components/scoop-logo";
import { Button } from "#/components/ui/button";
import { useCollections } from "#/lib/collections";
import { flavorForFeed } from "#/lib/flavor";
import { useSaved } from "#/lib/saved";
import {
	mergeSharedCollection,
	parseShareStructure,
	type ShareStructure,
} from "#/lib/share-merge";
import { FLAVORS, useSubscriptions } from "#/lib/subscriptions";
import type { Story } from "#/lib/types";
import type { ListResult } from "#/server/feeds";
import { getList } from "#/server/feeds";

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
	const { subscribe, isSubscribed, hydrated } = useSubscriptions();
	const [added, setAdded] = useState(false);

	const feeds = list.items;
	const title = list.title ?? "Shared flavors";

	const addAll = () => {
		// subscribe() is additive per-id (it skips ids you already follow), so
		// it's safe before hydration — but gate on `hydrated` for consistency with
		// the reading-list import, which is NOT additive.
		if (!hydrated) return;
		for (const feed of feeds) subscribe(feed.id);
		setAdded(true);
		router.navigate({ to: "/" });
	};

	// How many of these the recipient doesn't already follow — drives the label.
	const newCount = feeds.filter((f) => !isSubscribed(f.id)).length;

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
					disabled={added || !hydrated}
					className="rounded-full"
				>
					{added ? (
						<>
							<Check className="size-4" aria-hidden />
							Added!
						</>
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
 * reading list" runs the best-effort merge into the recipient's own stores and
 * lands them on /saved.
 */
function ReadingList({
	list,
}: {
	list: Extract<ListResult, { kind: "stories" }>;
}) {
	const router = useRouter();
	const {
		collections,
		hydrated: collectionsHydrated,
		replaceAll: replaceCollections,
	} = useCollections();
	const {
		saved,
		hydrated: savedHydrated,
		replaceAll: replaceSaved,
	} = useSaved();
	const [added, setAdded] = useState(false);

	const stories = list.items;
	const title = list.title ?? "Shared reading list";

	// Both stores must have hydrated from localStorage before we merge. Until then
	// `collections`/`saved` are the empty [] fallback, and importing would
	// replaceAll() over an empty base — wiping a returning user's existing list.
	const ready = collectionsHydrated && savedHydrated;

	// Parse the folder structure once; null falls back to a flat list.
	const structure = useMemo(
		() => parseShareStructure(list.structure),
		[list.structure],
	);

	const addAll = () => {
		// Read current stores, merge the share in, and write both back. The merge
		// is purely additive (never deletes), so re-importing is safe — but only
		// once hydrated, or we'd replaceAll() over the empty fallback.
		if (!ready) return;
		if (structure) {
			const merged = mergeSharedCollection({
				structure,
				collections,
				saved,
				newId: () => crypto.randomUUID(),
				nextColor: (count) => FLAVORS[count % FLAVORS.length],
				now: Date.now(),
			});
			replaceCollections(merged.collections);
			replaceSaved(merged.saved);
		} else {
			// No structure — just save the bare stories (preserving existing saves).
			const existing = new Set(saved.map((s) => s.storyId));
			const now = Date.now();
			replaceSaved([
				...saved,
				...stories
					.filter((s) => !existing.has(s.id))
					.map((s) => ({ storyId: s.id, savedAt: now, collections: [] })),
			]);
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
					) : !ready ? (
						"Churning…"
					) : (
						<>
							<Plus className="size-4" aria-hidden />
							Add to my reading list
						</>
					)}
				</Button>
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
