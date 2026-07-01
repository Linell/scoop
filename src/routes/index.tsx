import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Loader2, Plus, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowseFlavorsDialog } from "#/components/browse-flavors-dialog";
import { FlavorFilterMenu } from "#/components/flavor-filter-menu";
import { ScoopCard } from "#/components/scoop-card";
import { ScoopLogo } from "#/components/scoop-logo";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { voodooLoginUrl } from "#/lib/auth";
import { useFeedFilter } from "#/lib/feed-filter";
import { useFeedView } from "#/lib/feed-view";
import { FLAVORS, type Subscription } from "#/lib/flavor";
import { getBrowseSession } from "#/lib/session";
import { relativeTime } from "#/lib/time";
import type { Feed, Story } from "#/lib/types";
import { feedIdForUrl } from "#/lib/url";
import { useAddFeed } from "#/lib/use-add-feed";
import {
	getFeeds,
	getMySubscriptions,
	getPopularStories,
	getStories,
	recordStorySave,
	removeStorySave,
	subscribeFeed,
} from "#/server/feeds";

export const Route = createFileRoute("/")({
	// Signed-out: the popular-stories grid. Signed-in: hydrate their own
	// subscriptions + feed, sourced server-side instead of localStorage.
	loader: async ({ context }) => {
		if (!context.user) {
			return { signedIn: false as const, popular: await getPopularStories() };
		}
		const subs = await getMySubscriptions();
		const ids = subs.map((s) => s.feedId);
		const [feeds, stories] = await Promise.all([
			ids.length ? getFeeds({ data: ids }) : Promise.resolve([]),
			ids.length ? getStories({ data: ids }) : Promise.resolve([]),
		]);
		return {
			signedIn: true as const,
			subscriptions: subs.map((s) => ({ id: s.feedId, flavor: s.flavor })),
			feeds,
			stories,
		};
	},
	component: Home,
});

const SUGGESTED: { title: string; url: string }[] = [
	{ title: "Hacker News", url: "https://hnrss.org/frontpage" },
	{ title: "NASA", url: "https://www.nasa.gov/feed/" },
];

function Home() {
	const data = Route.useLoaderData();
	return data.signedIn ? (
		<SignedInHome
			initialSubscriptions={data.subscriptions}
			initialFeeds={data.feeds}
			initialStories={data.stories}
		/>
	) : (
		<SignedOutHome popular={data.popular} />
	);
}

/** The today's-date header, shared by both the signed-in and signed-out home. */
function todayHeading(): string {
	return new Date().toLocaleDateString("en-US", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

/**
 * Signed-out landing: no subscriptions to speak of, so the feed is the
 * catalog's most-engaged stories plus a banner nudging toward an account. The
 * save toggle and "browse" flow both prompt sign-in rather than silently
 * failing against server fns that now require a session.
 */
function SignedOutHome({ popular }: { popular: Story[] }) {
	const { view } = useFeedView();

	// The save toggle still renders for a signed-out visitor (so the affordance
	// is visible, not silently missing) — tapping it is a deliberate prompt to
	// sign in rather than a no-op against a server fn that now requires a session.
	const promptSignIn = useCallback(() => {
		window.location.href = voodooLoginUrl("/");
	}, []);

	return (
		<main id="main-content" className="mx-auto w-full max-w-6xl px-4 pb-24">
			<section className="melt-in py-10 sm:py-14">
				<p className="kicker">The scoop for</p>
				<h1 className="scoop-title mt-3 text-[2rem] text-foreground sm:text-6xl">
					{todayHeading()}
				</h1>

				<div className="whip-card mt-7 flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
					<div className="min-w-0">
						<p className="font-semibold text-foreground text-sm">
							Sign in to build your own flavors
						</p>
						<p className="text-cocoa-soft text-sm">
							Follow feeds, save scoops for later, and carry them to any device
							— it's your scoop shop, wherever you read.
						</p>
					</div>
					<Button asChild className="shrink-0 rounded-full">
						<a href={voodooLoginUrl("/")} className="no-underline">
							Sign in
						</a>
					</Button>
				</div>
			</section>

			<section className="min-w-0">
				<div className="mb-4 flex items-center justify-between gap-3">
					<h2 className="kicker">Popular scoops</h2>
				</div>

				{popular.length === 0 ? (
					<EmptyScoops>
						Nothing churning yet — check back once the kitchen's warmed up.
					</EmptyScoops>
				) : (
					<div className="grid gap-5 sm:grid-cols-2">
						{popular.map((story, i) => (
							<ScoopCard
								key={story.id}
								story={story}
								feed={undefined}
								flavor={FLAVORS[i % FLAVORS.length]}
								index={i}
								view={view}
								saved={false}
								onToggleSave={promptSignIn}
							/>
						))}
					</div>
				)}
			</section>
		</main>
	);
}

function SignedInHome({
	initialSubscriptions,
	initialFeeds,
	initialStories,
}: {
	initialSubscriptions: Subscription[];
	initialFeeds: Feed[];
	initialStories: Story[];
}) {
	const [subscriptions, setSubscriptions] = useState(initialSubscriptions);
	const [feeds, setFeeds] = useState<Feed[]>(initialFeeds);
	const [stories, setStories] = useState<Story[]>(initialStories);
	const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());
	const savedIdsRef = useRef(savedIds);
	savedIdsRef.current = savedIds;
	const [loading, setLoading] = useState(false);
	const [dialogOpen, setDialogOpen] = useState(false);
	// How cards render — text-only (default) or with lead images. Set on the
	// Settings page and remembered; the feed itself stays free of chrome.
	const { view } = useFeedView();
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

	const isSubscribed = useCallback(
		(id: string) => subscriptions.some((s) => s.id === id),
		[subscriptions],
	);

	// Follow a feed server-side and reflect it locally — the account-backed
	// successor to useSubscriptions' localStorage writer.
	const subscribe = useCallback(
		(id: string) => {
			if (isSubscribed(id)) return;
			const flavor = FLAVORS[subscriptions.length % FLAVORS.length];
			setSubscriptions((prev) =>
				prev.some((s) => s.id === id) ? prev : [...prev, { id, flavor }],
			);
			subscribeFeed({ data: { feedId: id, flavor } }).catch(() => {
				setSubscriptions((prev) => prev.filter((s) => s.id !== id));
			});
		},
		[isSubscribed, subscriptions.length],
	);

	// Refetch feed records + stories whenever the subscription set changes.
	useEffect(() => {
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
	}, [ids]);

	// Drop any focused flavors the visitor has since unsubscribed, so a stale
	// filter can't leave the feed empty. Wait until the filter has hydrated so we
	// don't prune against an empty selection on first paint.
	useEffect(() => {
		if (filterHydrated) retainFilter(ids);
	}, [filterHydrated, ids, retainFilter]);

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

	// The shared follow flow: addByUrl (for the empty-state's suggested URLs) and
	// onDialogAdd (the browse dialog's combined catalog-pick / paste-URL handler).
	const { addByUrl, onDialogAdd } = useAddFeed(subscribe);

	// Save handler shared by every card in the grid. Signed-in only (this
	// component never renders signed-out), so no login-guard needed here — that
	// lives in SignedOutHome's promptSignIn instead.
	const onToggleSave = useCallback((storyId: string) => {
		const wasSaved = savedIdsRef.current.has(storyId);
		setSavedIds((prev) => {
			const next = new Set(prev);
			if (wasSaved) next.delete(storyId);
			else next.add(storyId);
			return next;
		});
		const revert = () =>
			setSavedIds((prev) => {
				const next = new Set(prev);
				if (wasSaved) next.add(storyId);
				else next.delete(storyId);
				return next;
			});
		if (wasSaved) {
			removeStorySave({ data: storyId }).catch(revert);
		} else {
			recordStorySave({
				data: { storyId, browseSession: getBrowseSession() },
			}).catch(revert);
		}
	}, []);

	const showSkeletons = loading && stories.length === 0;

	return (
		<main id="main-content" className="mx-auto w-full max-w-6xl px-4 pb-24">
			{/* Hero */}
			<section className="melt-in py-10 sm:py-14">
				<p className="kicker">The scoop for</p>
				<h1 className="scoop-title mt-3 text-[2rem] text-foreground sm:text-6xl">
					{todayHeading()}
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
						{subscriptions.length > 0 ? (
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
									saved={savedIds.has(story.id)}
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
				onAdd={onDialogAdd}
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
