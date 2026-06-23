import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Loader2, Plus, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowseFlavorsDialog } from "#/components/browse-flavors-dialog";
import { FlavorFilterMenu } from "#/components/flavor-filter-menu";
import { ScoopCard } from "#/components/scoop-card";
import { ScoopLogo } from "#/components/scoop-logo";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { getClientId } from "#/lib/client-id";
import { useFeedFilter } from "#/lib/feed-filter";
import { useFeedView } from "#/lib/feed-view";
import { useSaved } from "#/lib/saved";
import { getBrowseSession } from "#/lib/session";
import { FLAVORS, useSubscriptions } from "#/lib/subscriptions";
import { relativeTime } from "#/lib/time";
import type { Feed, Story } from "#/lib/types";
import { feedIdForUrl } from "#/lib/url";
import { addFeed, getFeeds, getStories, recordStorySave } from "#/server/feeds";

export const Route = createFileRoute("/")({ component: Home });

const SUGGESTED: { title: string; url: string }[] = [
	{ title: "Hacker News", url: "https://hnrss.org/frontpage" },
	{ title: "NASA", url: "https://www.nasa.gov/feed/" },
];

function Home() {
	const { subscriptions, hydrated, subscribe, isSubscribed } =
		useSubscriptions();
	// How cards render — text-only (default) or with lead images. Set on the
	// Settings page and remembered; the feed itself stays free of chrome.
	const { view } = useFeedView();
	// One saved-store subscription for the whole grid — the cards are
	// presentational and just take a `saved` flag plus a toggle handler, so
	// saving one story no longer re-renders every card.
	const { isSaved, toggle } = useSaved();

	const [feeds, setFeeds] = useState<Feed[]>([]);
	const [stories, setStories] = useState<Story[]>([]);
	const [loading, setLoading] = useState(false);
	const [dialogOpen, setDialogOpen] = useState(false);
	// Which flavors the feed is focused on (multi-select). An empty set means
	// "show every flavor". Persisted to localStorage so focus survives reloads.
	const {
		selected,
		hydrated: filterHydrated,
		toggle: toggleFilter,
		clear: clearFilter,
		retain: retainFilter,
	} = useFeedFilter();

	const ids = useMemo(() => subscriptions.map((s) => s.id), [subscriptions]);

	const flavorById = useMemo(
		() => new Map(subscriptions.map((s) => [s.id, s.flavor])),
		[subscriptions],
	);
	const feedById = useMemo(() => new Map(feeds.map((f) => [f.id, f])), [feeds]);

	const lastChurned = useMemo(
		() => (feeds.length ? Math.max(...feeds.map((f) => f.fetchedAt)) : null),
		[feeds],
	);

	// Refetch feed records + stories whenever the subscription set changes.
	useEffect(() => {
		if (!hydrated) return;
		if (ids.length === 0) {
			setFeeds([]);
			setStories([]);
			return;
		}
		let cancelled = false;
		setLoading(true);
		Promise.all([getFeeds({ data: ids }), getStories({ data: ids })])
			.then(([f, s]) => {
				if (cancelled) return;
				setFeeds(f);
				setStories(s);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [ids, hydrated]);

	// Drop any focused flavors the visitor has since unsubscribed, so a stale
	// filter can't leave the feed empty. Wait until both sides have hydrated so
	// we don't prune against an empty subscription list on first paint.
	useEffect(() => {
		if (hydrated && filterHydrated) retainFilter(ids);
	}, [hydrated, filterHydrated, ids, retainFilter]);

	// Filtering is purely client-side: narrow the already-loaded stories to the
	// focused flavors before rendering the grid. Empty selection = show all.
	const visibleStories = useMemo(
		() =>
			selected.size > 0
				? stories.filter((s) => selected.has(s.feedId))
				: stories,
		[stories, selected],
	);

	// The subscribed flavors currently in the filter, in sidebar order — drives
	// the empty-state copy and the grid's re-scoop key.
	const selectedSubs = useMemo(
		() => subscriptions.filter((s) => selected.has(s.id)),
		[subscriptions, selected],
	);

	// Add (or refresh) a feed by URL and subscribe to it. Returns an error string.
	const addByUrl = useCallback(
		async (url: string): Promise<string | null> => {
			const res = await addFeed({ data: url });
			if (!res.ok) return res.error;
			subscribe(res.feed.id);
			return null;
		},
		[subscribe],
	);

	// Save handler shared by every card in the grid. On a transition INTO saved,
	// fire the durable save signal best-effort; unsaving is purely local.
	const onToggleSave = useCallback(
		(storyId: string) => {
			const wasSaved = isSaved(storyId);
			toggle(storyId);
			if (!wasSaved) {
				recordStorySave({
					data: {
						storyId,
						browseSession: getBrowseSession(),
						clientId: getClientId(),
					},
				}).catch(() => {});
			}
		},
		[isSaved, toggle],
	);

	const showSkeletons = !hydrated || (loading && stories.length === 0);

	const today = new Date().toLocaleDateString("en-US", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
	});

	return (
		<main id="main-content" className="mx-auto w-full max-w-6xl px-4 pb-24">
			{/* Hero */}
			<section className="melt-in py-10 sm:py-14">
				<p className="kicker">The scoop for</p>
				<h1 className="scoop-title mt-3 text-[2rem] text-foreground sm:text-6xl">
					{today}
				</h1>

				<Link
					to="/chat"
					className="focus-scoop mt-7 flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-5 py-3.5 no-underline shadow-sm transition-colors hover:border-strawberry"
				>
					<Sparkles
						className="size-5 shrink-0 text-strawberry-ink"
						aria-hidden
					/>
					<span className="truncate text-cocoa-soft">
						Ask Scoop about today's stories…
					</span>
					<ArrowRight
						className="ml-auto size-4 shrink-0 text-cocoa-soft"
						aria-hidden
					/>
				</Link>
			</section>

			<section className="min-w-0">
				<div className="mb-4 flex items-center justify-between gap-3">
					<div className="flex min-w-0 items-center gap-3">
						<h2 className="kicker">Fresh scoops</h2>
						{hydrated && subscriptions.length > 0 ? (
							<FlavorFilterMenu
								subscriptions={subscriptions}
								feedById={feedById}
								selected={selected}
								onToggle={toggleFilter}
								onClear={clearFilter}
							/>
						) : null}
					</div>
					{lastChurned ? (
						<span className="shrink-0 text-xs text-cocoa-soft">
							churned {relativeTime(lastChurned)}
						</span>
					) : null}
				</div>

				{/* Announce loading → loaded → empty transitions (and the result
				    count change when a flavor filter is toggled). */}
				<div aria-live="polite" aria-busy={showSkeletons}>
					{showSkeletons ? (
						<div className="grid gap-5 sm:grid-cols-2">
							<output className="sr-only">Loading fresh scoops…</output>
							{FLAVORS.map((flavor, i) => (
								<ScoopCardSkeleton key={flavor} flavor={flavor} index={i} />
							))}
						</div>
					) : subscriptions.length === 0 ? (
						<EmptyState
							onAdd={addByUrl}
							onBrowse={() => setDialogOpen(true)}
							isSubscribed={isSubscribed}
						/>
					) : stories.length === 0 ? (
						<EmptyScoops>
							No stories yet — these feeds didn't churn anything we could read.
						</EmptyScoops>
					) : visibleStories.length === 0 ? (
						<EmptyScoops>
							No scoops from{" "}
							<span className="font-semibold text-foreground">
								{selectedSubs.length === 1
									? (feedById.get(selectedSubs[0].id)?.title ?? "this flavor")
									: "these flavors"}
							</span>{" "}
							yet — it hasn't churned anything we could read.
						</EmptyScoops>
					) : (
						// Key the grid on the active filter so toggling a flavor re-runs
						// the staggered melt-in — the feed "re-scoops" rather than swapping.
						<div
							key={selectedSubs.map((s) => s.id).join(",") || "all"}
							className="grid gap-5 sm:grid-cols-2"
						>
							{visibleStories.map((story, i) => (
								<ScoopCard
									key={story.id}
									story={story}
									feed={feedById.get(story.feedId)}
									flavor={flavorById.get(story.feedId) ?? "var(--strawberry)"}
									index={i}
									view={view}
									saved={isSaved(story.id)}
									onToggleSave={() => onToggleSave(story.id)}
								/>
							))}
						</div>
					)}
				</div>
			</section>

			<BrowseFlavorsDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				onAdd={addByUrl}
				isSubscribed={isSubscribed}
			/>
		</main>
	);
}

/** A gently-designed "nothing here yet" card, so empty states match the warmth
 * of the loading skeletons rather than reading as a bare line of text. */
function EmptyScoops({ children }: { children: React.ReactNode }) {
	return (
		<div className="whip-card flex flex-col items-center gap-3 p-8 text-center">
			<ScoopLogo className="h-10 w-10 opacity-70 grayscale" />
			<p className="max-w-[44ch] text-cocoa-soft">{children}</p>
		</div>
	);
}

function EmptyState({
	onAdd,
	onBrowse,
	isSubscribed,
}: {
	onAdd: (url: string) => Promise<string | null>;
	onBrowse: () => void;
	isSubscribed: (id: string) => boolean;
}) {
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const add = async (url: string) => {
		setBusy(url);
		setError(null);
		try {
			const err = await onAdd(url);
			if (err) setError(err);
		} catch {
			setError("Something went wrong adding that feed.");
		} finally {
			setBusy(null);
		}
	};

	return (
		<div className="whip-card flex flex-col items-center gap-5 p-8 text-center">
			<p className="max-w-[40ch] text-cocoa-soft">
				No flavors yet. Browse the scoop shop, or start with one of these:
			</p>
			{error ? (
				<p role="alert" className="text-sm text-strawberry-ink">
					{error}
				</p>
			) : null}
			<div className="flex flex-wrap justify-center gap-2">
				{SUGGESTED.map((s) => (
					<button
						key={s.url}
						type="button"
						disabled={busy != null || isSubscribed(feedIdForUrl(s.url))}
						onClick={() => add(s.url)}
						className="focus-scoop inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-sm text-cocoa-soft shadow-sm transition-colors hover:border-strawberry hover:text-foreground disabled:opacity-50"
					>
						{busy === s.url ? (
							<Loader2 className="size-3.5 animate-spin" aria-hidden />
						) : (
							<Plus className="size-3.5" aria-hidden />
						)}
						{s.title}
					</button>
				))}
			</div>
			<Button onClick={onBrowse} className="rounded-full">
				<Sparkles className="size-4" aria-hidden />
				Browse all flavors
			</Button>
		</div>
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
