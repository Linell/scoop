import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowLeft,
	ArrowRight,
	Check,
	ChevronRight,
	Loader2,
	Plus,
	Sparkles,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	CommandDialog,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "#/components/ui/command";
import { Skeleton } from "#/components/ui/skeleton";
import { groupByCategory, loadCatalog } from "#/lib/catalog";
import { useFeedFilter } from "#/lib/feed-filter";
import { FLAVORS, useSubscriptions } from "#/lib/subscriptions";
import { relativeTime } from "#/lib/time";
import type { CatalogFeed, Feed, Story } from "#/lib/types";
import { feedIdForUrl } from "#/lib/url";
import { addFeed, getFeeds, getStories } from "#/server/feeds";

export const Route = createFileRoute("/")({ component: Home });

const SUGGESTED: { title: string; url: string }[] = [
	{ title: "Hacker News", url: "https://hnrss.org/frontpage" },
	{ title: "NASA", url: "https://www.nasa.gov/feed/" },
];

function Home() {
	const { subscriptions, hydrated, subscribe, unsubscribe, isSubscribed } =
		useSubscriptions();

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
	// the header chip and its label.
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

	const showSkeletons = !hydrated || (loading && stories.length === 0);

	const today = new Date().toLocaleDateString("en-US", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
	});

	return (
		<main className="mx-auto w-full max-w-6xl px-4 pb-24">
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
					<Sparkles className="size-5 shrink-0 text-strawberry-ink" />
					<span className="truncate text-cocoa-soft">
						Ask Scoop about today's stories…
					</span>
					<ArrowRight className="ml-auto size-4 shrink-0 text-cocoa-soft" />
				</Link>
			</section>

			<div className="grid gap-8 lg:grid-cols-[240px_1fr]">
				{/* Your flavors */}
				<aside className="lg:sticky lg:top-20 lg:self-start">
					<div className="flex items-center justify-between">
						<p className="kicker">Your flavors</p>
						<span className="text-xs text-cocoa-soft">
							{hydrated ? subscriptions.length : ""}
						</span>
					</div>

					{!hydrated ? (
						<FlavorListSkeleton />
					) : (
						<ul className="mt-4 space-y-1">
							{subscriptions.length > 0 ? (
								<li>
									<button
										type="button"
										onClick={clearFilter}
										aria-pressed={selected.size === 0}
										data-active={selected.size === 0}
										style={
											{ "--flavor": "var(--strawberry)" } as React.CSSProperties
										}
										className={`flavor-row focus-scoop flex min-h-11 w-full items-center gap-3 rounded-full px-3 py-2 text-left text-sm ${
											selected.size === 0
												? "font-semibold text-foreground"
												: "text-cocoa-soft"
										}`}
									>
										<Sparkles className="size-4 shrink-0 text-strawberry-ink" />
										<span className="truncate">All flavors</span>
									</button>
								</li>
							) : null}
							{subscriptions.map((sub) => {
								const feed = feedById.get(sub.id);
								const active = selected.has(sub.id);
								return (
									<li key={sub.id} className="group/flavor">
										<div
											data-active={active}
											style={{ "--flavor": sub.flavor } as React.CSSProperties}
											className="flavor-row flex min-h-11 w-full items-center rounded-full pr-1"
										>
											<button
												type="button"
												onClick={() => toggleFilter(sub.id)}
												aria-pressed={active}
												aria-label={`Filter by ${feed?.title ?? "feed"}`}
												className="focus-scoop flex min-w-0 flex-1 items-center gap-3 rounded-full px-3 py-2 text-left"
											>
												<span className="flavor-dot shrink-0" />
												<span
													title={feed?.title}
													className={`truncate text-sm ${
														active
															? "font-semibold text-foreground"
															: "text-foreground"
													}`}
												>
													{feed?.title ?? "Loading…"}
												</span>
											</button>
											<button
												type="button"
												onClick={() => unsubscribe(sub.id)}
												aria-label={`Remove ${feed?.title ?? "feed"}`}
												className={`focus-scoop shrink-0 rounded-full p-1 text-cocoa-soft transition-opacity hover:text-strawberry-ink group-hover/flavor:opacity-100 ${
													active ? "opacity-100" : "opacity-0"
												}`}
											>
												<X className="size-3.5" />
											</button>
										</div>
									</li>
								);
							})}
						</ul>
					)}

					<Button
						variant="ghost"
						onClick={() => setDialogOpen(true)}
						className="mt-2 w-full justify-start rounded-full text-cocoa-soft"
					>
						<Plus className="size-4" />
						Add a flavor
					</Button>
				</aside>

				{/* The feed */}
				<section>
					<div className="mb-4 flex items-baseline justify-between gap-3">
						<div className="flex min-w-0 items-baseline gap-2">
							<p className="kicker">Fresh scoops</p>
							{selectedSubs.length > 0
								? (() => {
										const n = selectedSubs.length;
										const onlyTitle =
											n === 1 ? feedById.get(selectedSubs[0].id)?.title : null;
										const label =
											onlyTitle ?? `${n} ${n === 1 ? "flavor" : "flavors"}`;
										return (
											<button
												type="button"
												onClick={clearFilter}
												aria-label={`Showing ${onlyTitle ?? `${n} flavors`}. Clear filter.`}
												title="Clear filter"
												style={
													{
														"--flavor":
															n === 1
																? selectedSubs[0].flavor
																: "var(--strawberry)",
													} as React.CSSProperties
												}
												className="flavor-chip focus-scoop min-w-0 shrink"
											>
												<span className="flavor-chip__dots shrink-0">
													{selectedSubs.slice(0, 3).map((s) => (
														<span
															key={s.id}
															className="flavor-dot"
															style={
																{ "--flavor": s.flavor } as React.CSSProperties
															}
														/>
													))}
												</span>
												<span title={label} className="truncate">
													{label}
												</span>
												<span
													className="flavor-chip__x shrink-0"
													aria-hidden="true"
												>
													<X className="size-3" />
												</span>
											</button>
										);
									})()
								: null}
						</div>
						{lastChurned ? (
							<span className="shrink-0 text-xs text-cocoa-soft">
								churned {relativeTime(lastChurned)}
							</span>
						) : null}
					</div>

					{showSkeletons ? (
						<div className="grid gap-5 sm:grid-cols-2">
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
						<p className="text-cocoa-soft">
							No stories yet — these feeds didn't churn anything we could read.
						</p>
					) : visibleStories.length === 0 ? (
						<p className="text-cocoa-soft">
							No scoops from{" "}
							<span className="font-semibold text-foreground">
								{selectedSubs.length === 1
									? (feedById.get(selectedSubs[0].id)?.title ?? "this flavor")
									: "these flavors"}
							</span>{" "}
							yet — it hasn't churned anything we could read.
						</p>
					) : (
						<div className="grid gap-5 sm:grid-cols-2">
							{visibleStories.map((story, i) => (
								<ScoopCard
									key={story.id}
									story={story}
									feed={feedById.get(story.feedId)}
									flavor={flavorById.get(story.feedId) ?? "var(--strawberry)"}
									index={i}
								/>
							))}
						</div>
					)}
				</section>
			</div>

			<BrowseFlavorsDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				onAdd={addByUrl}
				isSubscribed={isSubscribed}
			/>
		</main>
	);
}

function ScoopCard({
	story,
	feed,
	flavor,
	index,
}: {
	story: Story;
	feed: Feed | undefined;
	flavor: string;
	index: number;
}) {
	return (
		<Link
			to="/story/$storyId"
			params={{ storyId: story.id }}
			className="whip-card whip-card-hover focus-scoop melt-in group flex h-full flex-col overflow-hidden text-left no-underline"
			style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
		>
			<div
				className="flavor-band h-2 w-full"
				style={{ "--flavor": flavor } as React.CSSProperties}
			/>
			<div className="flex flex-1 flex-col gap-3 p-5">
				<div className="flex items-center gap-2">
					<span
						className="flavor-dot shrink-0"
						style={{ "--flavor": flavor } as React.CSSProperties}
					/>
					<span className="truncate text-xs text-cocoa-soft">
						{feed?.title ?? "Feed"}
					</span>
					<span className="ml-auto shrink-0 text-xs text-cocoa-soft">
						{relativeTime(story.publishedAt)}
					</span>
				</div>

				<h3 className="font-semibold text-base text-foreground leading-snug">
					{story.title}
				</h3>

				{story.summary ? (
					<p className="line-clamp-3 text-sm text-cocoa-soft">
						{story.summary}
					</p>
				) : (
					<p className="text-sm text-cocoa-soft italic">
						Scoop is still churning this one…
					</p>
				)}

				<div className="mt-auto flex items-center gap-1.5 pt-1 font-semibold text-sm text-strawberry-ink">
					Read the full scoop
					<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
				</div>
			</div>
		</Link>
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

	const add = async (url: string) => {
		setBusy(url);
		await onAdd(url);
		setBusy(null);
	};

	return (
		<div className="whip-card flex flex-col items-center gap-5 p-8 text-center">
			<p className="max-w-[40ch] text-cocoa-soft">
				No flavors yet. Browse the scoop shop, or start with one of these:
			</p>
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
							<Loader2 className="size-3.5 animate-spin" />
						) : (
							<Plus className="size-3.5" />
						)}
						{s.title}
					</button>
				))}
			</div>
			<Button onClick={onBrowse} className="rounded-full">
				<Sparkles className="size-4" />
				Browse all flavors
			</Button>
		</div>
	);
}

/** Does the search box hold something we can treat as a feed URL? */
function looksLikeUrl(query: string): boolean {
	const q = query.trim();
	if (!q || /\s/.test(q)) return false;
	return /^https?:\/\//i.test(q) || /^[\w-]+(\.[\w-]+)+/.test(q);
}

// Cap search results so a broad term (e.g. "the") can't re-flood the list.
const MAX_RESULTS = 50;

/**
 * Browse + search the bundled feed catalog (or paste a raw URL). With no query
 * the dialog is a short category index you drill into; typing searches across
 * every feed at once. Picking a feed runs it through the same live-ingest add
 * path, and each row tracks its own add state.
 */
function BrowseFlavorsDialog({
	open,
	onOpenChange,
	onAdd,
	isSubscribed,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onAdd: (url: string) => Promise<string | null>;
	isSubscribed: (id: string) => boolean;
}) {
	const [catalog, setCatalog] = useState<CatalogFeed[] | null>(null);
	const [query, setQuery] = useState("");
	const [category, setCategory] = useState<string | null>(null);
	const [busy, setBusy] = useState<Set<string>>(new Set());
	const [error, setError] = useState<string | null>(null);

	// Pull the catalog the first time the dialog opens — it's a dynamic import,
	// so it stays out of the initial bundle until someone goes looking.
	useEffect(() => {
		if (open && !catalog) loadCatalog().then(setCatalog, () => setCatalog([]));
	}, [open, catalog]);

	const groups = useMemo(
		() => (catalog ? groupByCategory(catalog) : []),
		[catalog],
	);

	const q = query.trim().toLowerCase();
	const results = useMemo(() => {
		if (!catalog || !q) return [];
		return catalog
			.filter(
				(f) =>
					f.title.toLowerCase().includes(q) ||
					f.category.toLowerCase().includes(q) ||
					(f.description?.toLowerCase().includes(q) ?? false),
			)
			.slice(0, MAX_RESULTS);
	}, [catalog, q]);

	const add = async (url: string) => {
		if (busy.has(url)) return;
		setBusy((prev) => new Set(prev).add(url));
		setError(null);
		const err = await onAdd(url);
		setBusy((prev) => {
			const next = new Set(prev);
			next.delete(url);
			return next;
		});
		if (err) setError(err);
	};

	// Reset navigation when the dialog closes so it reopens at the top level.
	const handleOpenChange = (next: boolean) => {
		if (!next) {
			setQuery("");
			setCategory(null);
			setError(null);
		}
		onOpenChange(next);
	};

	const rowProps = (feed: CatalogFeed) => ({
		url: feed.url,
		title: feed.title,
		description: feed.description,
		busy: busy.has(feed.url),
		added: isSubscribed(feedIdForUrl(feed.url)),
		onAdd: add,
	});

	const current = category ? groups.find((g) => g.category === category) : null;
	const showUrlItem = looksLikeUrl(query);

	return (
		<CommandDialog
			open={open}
			onOpenChange={handleOpenChange}
			title="Add a flavor"
			description="Search the scoop shop or paste any RSS or Atom feed URL."
			className="max-w-xl"
			shouldFilter={false}
		>
			<CommandInput
				placeholder="Search every flavor, or paste a feed URL…"
				value={query}
				onValueChange={setQuery}
			/>
			{error ? (
				<p className="border-border border-b px-4 py-2 text-sm text-strawberry-ink">
					{error}
				</p>
			) : null}
			<CommandList>
				{catalog == null ? (
					<p className="py-8 text-center text-cocoa-soft text-sm">
						Churning the catalog…
					</p>
				) : showUrlItem ? (
					<CommandGroup heading="Add by URL">
						<FeedRow
							url={query.trim()}
							title={query.trim()}
							description="Add this RSS or Atom feed directly"
							busy={busy.has(query.trim())}
							added={isSubscribed(feedIdForUrl(query.trim()))}
							onAdd={add}
						/>
					</CommandGroup>
				) : q ? (
					results.length === 0 ? (
						<p className="py-8 text-center text-cocoa-soft text-sm">
							No flavors match “{query.trim()}”.
						</p>
					) : (
						<CommandGroup
							heading={`${results.length}${
								results.length === MAX_RESULTS ? "+" : ""
							} ${results.length === 1 ? "match" : "matches"}`}
						>
							{results.map((feed) => (
								<FeedRow
									key={feed.url}
									meta={feed.category}
									{...rowProps(feed)}
								/>
							))}
						</CommandGroup>
					)
				) : current ? (
					<CommandGroup
						heading={`${current.category} · ${current.feeds.length}`}
					>
						<CommandItem
							value="__back"
							onSelect={() => setCategory(null)}
							className="text-cocoa-soft"
						>
							<ArrowLeft className="size-4" />
							All categories
						</CommandItem>
						{current.feeds.map((feed) => (
							<FeedRow key={feed.url} {...rowProps(feed)} />
						))}
					</CommandGroup>
				) : (
					<CommandGroup heading="Browse by category">
						{groups.map((group) => (
							<CategoryRow
								key={group.category}
								category={group.category}
								count={group.feeds.length}
								onSelect={() => setCategory(group.category)}
							/>
						))}
					</CommandGroup>
				)}
			</CommandList>
		</CommandDialog>
	);
}

function CategoryRow({
	category,
	count,
	onSelect,
}: {
	category: string;
	count: number;
	onSelect: () => void;
}) {
	return (
		<CommandItem value={`cat:${category}`} onSelect={onSelect}>
			<span className="truncate text-foreground">{category}</span>
			<span className="ml-auto shrink-0 text-cocoa-soft text-xs">{count}</span>
			<ChevronRight className="size-4 shrink-0 text-cocoa-soft" />
		</CommandItem>
	);
}

function FeedRow({
	url,
	title,
	description,
	meta,
	busy,
	added,
	onAdd,
}: {
	url: string;
	title: string;
	description: string | null;
	meta?: string;
	busy: boolean;
	added: boolean;
	onAdd: (url: string) => void;
}) {
	return (
		<CommandItem
			value={url}
			disabled={busy || added}
			onSelect={() => onAdd(url)}
		>
			<div className="flex min-w-0 flex-col gap-0.5">
				<div className="flex min-w-0 items-center gap-2">
					<span className="truncate text-foreground">{title}</span>
					{meta ? (
						<span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground uppercase tracking-wide">
							{meta}
						</span>
					) : null}
				</div>
				{description ? (
					<span className="truncate text-cocoa-soft text-xs">
						{description}
					</span>
				) : null}
			</div>
			<span className="ml-auto shrink-0 text-cocoa-soft">
				{busy ? (
					<Loader2 className="size-4 animate-spin" />
				) : added ? (
					<Check className="size-4 text-accent-foreground" />
				) : (
					<Plus className="size-4" />
				)}
			</span>
		</CommandItem>
	);
}

function FlavorListSkeleton() {
	const widths = ["70%", "52%", "64%", "46%", "60%", "50%"];
	return (
		<ul className="mt-4 space-y-1">
			{FLAVORS.map((flavor, i) => (
				<li key={flavor}>
					<div className="flex min-h-11 w-full items-center gap-3 rounded-full px-3 py-2">
						<span
							className="flavor-dot shrink-0"
							style={{ "--flavor": flavor } as React.CSSProperties}
						/>
						<Skeleton
							className="h-3.5 rounded-full"
							style={{ width: widths[i] }}
						/>
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
