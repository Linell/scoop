import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowLeft,
	ArrowRight,
	Check,
	ChevronRight,
	Loader2,
	MoreHorizontal,
	Pencil,
	Plus,
	Share2,
	Sparkles,
	X,
} from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScoopCard } from "#/components/scoop-card";
import { ScoopLogo } from "#/components/scoop-logo";
import { ShareDialog } from "#/components/share-dialog";
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
import { getClientId } from "#/lib/client-id";
import { useFeedFilter } from "#/lib/feed-filter";
import { useFeedView } from "#/lib/feed-view";
import { useSaved } from "#/lib/saved";
import { getBrowseSession } from "#/lib/session";
import {
	FLAVORS,
	type Subscription,
	useSubscriptions,
} from "#/lib/subscriptions";
import { relativeTime } from "#/lib/time";
import type { CatalogFeed, Feed, Story } from "#/lib/types";
import { feedIdForUrl } from "#/lib/url";
import {
	addFeed,
	createList,
	getFeeds,
	getStories,
	recordStorySave,
} from "#/server/feeds";

export const Route = createFileRoute("/")({ component: Home });

const SUGGESTED: { title: string; url: string }[] = [
	{ title: "Hacker News", url: "https://hnrss.org/frontpage" },
	{ title: "NASA", url: "https://www.nasa.gov/feed/" },
];

function Home() {
	const {
		subscriptions,
		hydrated,
		subscribe,
		unsubscribe,
		restore,
		isSubscribed,
	} = useSubscriptions();
	// How cards render — text-only (default) or with lead images. Set on the
	// About page and remembered; the feed itself stays free of chrome.
	const { view } = useFeedView();
	// One saved-store subscription for the whole grid — the cards are
	// presentational and just take a `saved` flag plus a toggle handler, so
	// saving one story no longer re-renders every card.
	const { isSaved, toggle } = useSaved();

	const [feeds, setFeeds] = useState<Feed[]>([]);
	const [stories, setStories] = useState<Story[]>([]);
	const [loading, setLoading] = useState(false);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [shareOpen, setShareOpen] = useState(false);
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

	// Unfollowing is soft-destructive, so it never happens silently: we stash the
	// removed subscription (and where it sat) and surface an "Undo" toast for a
	// few seconds. Restoring puts the exact flavor back in place, so an accidental
	// unfollow costs one tap to reverse.
	const [undo, setUndo] = useState<{
		sub: Subscription;
		index: number;
		title: string;
	} | null>(null);

	const unfollow = useCallback(
		(id: string) => {
			const removed = unsubscribe(id);
			if (!removed) return;
			const title = feedById.get(id)?.title ?? "that flavor";
			setUndo({ ...removed, title });
		},
		[unsubscribe, feedById],
	);

	const undoUnfollow = useCallback(() => {
		setUndo((u) => {
			if (u) restore(u.sub, u.index);
			return null;
		});
	}, [restore]);

	// One effect owns the auto-dismiss: a fresh unfollow swaps in a new `undo`
	// object, which re-runs this and restarts the 6s timer; the cleanup also
	// covers an Undo click (state → null) and unmount mid-countdown.
	useEffect(() => {
		if (!undo) return;
		const timer = setTimeout(() => setUndo(null), 6000);
		return () => clearTimeout(timer);
	}, [undo]);

	// Publish the visitor's current flavors as a shared feeds list and resolve to
	// its /l/<slug> link. The callback must stay stable so the ShareDialog effect
	// doesn't re-fire on every subscribe/unsubscribe (or cross-tab storage event)
	// and mint a fresh shared_lists row, orphaning the slug the user copied. Read
	// the current ids through a ref and mint whatever is subscribed at click time.
	const idsRef = useRef(ids);
	idsRef.current = ids;
	const createFlavorsLink = useCallback(async (): Promise<string> => {
		const { slug } = await createList({
			data: { kind: "feeds", ids: idsRef.current, clientId: getClientId() },
		});
		return `${window.location.origin}/l/${slug}`;
	}, []);

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

			<div className="grid gap-8 lg:grid-cols-[240px_1fr]">
				{/* Your flavors — full sidebar on desktop; on small screens this is
				    hidden in favor of the horizontal FlavorStrip inside the feed. */}
				<aside className="hidden lg:sticky lg:top-20 lg:block lg:self-start">
					<div className="flex items-center justify-between">
						<h2 className="kicker">Your flavors</h2>
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
										<Sparkles
											className="size-4 shrink-0 text-strawberry-ink"
											aria-hidden
										/>
										<span className="truncate">All flavors</span>
									</button>
								</li>
							) : null}
							{subscriptions.map((sub) => {
								const feed = feedById.get(sub.id);
								const active = selected.has(sub.id);
								return (
									<li key={sub.id}>
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
											<UnfollowControl
												title={feed?.title ?? "this flavor"}
												onConfirm={() => unfollow(sub.id)}
											/>
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
						<Plus className="size-4" aria-hidden />
						Add a flavor
					</Button>

					{/* Share is only meaningful once there's something to share. */}
					{hydrated && subscriptions.length > 0 ? (
						<Button
							variant="ghost"
							onClick={() => setShareOpen(true)}
							className="w-full justify-start rounded-full text-cocoa-soft"
						>
							<Share2 className="size-4" aria-hidden />
							Share my flavors
						</Button>
					) : null}
				</aside>

				{/* The feed. min-w-0 lets this grid track shrink below the flavor
				    strip's intrinsic width, so the strip clips + scrolls instead of
				    stretching the whole page wide on mobile. */}
				<section className="min-w-0">
					{hydrated && subscriptions.length > 0 ? (
						<FlavorStrip
							subscriptions={subscriptions}
							feedById={feedById}
							selected={selected}
							onToggle={toggleFilter}
							onClear={clearFilter}
							onUnfollow={unfollow}
							onAdd={() => setDialogOpen(true)}
							onShare={() => setShareOpen(true)}
						/>
					) : null}
					<div className="mb-4 flex items-baseline justify-between gap-3">
						<div className="flex min-w-0 items-baseline gap-2">
							<h2 className="kicker">Fresh scoops</h2>
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
								No stories yet — these feeds didn't churn anything we could
								read.
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
			</div>

			<BrowseFlavorsDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				onAdd={addByUrl}
				isSubscribed={isSubscribed}
			/>

			<ShareDialog
				open={shareOpen}
				onOpenChange={setShareOpen}
				title="Share your flavors"
				description="Anyone with this link can add your flavors to their own scoop."
				createLink={createFlavorsLink}
			/>

			{/* Undo toast for an unfollow — the safety net that keeps unfollowing
			    from being a silent, irreversible tap. */}
			<div
				aria-live="polite"
				className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
			>
				{undo ? (
					<div className="melt-in pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2.5 text-sm text-foreground shadow-lg">
						<span className="truncate">
							Unfollowed <span className="font-semibold">{undo.title}</span>
						</span>
						<button
							type="button"
							onClick={undoUnfollow}
							className="focus-scoop shrink-0 rounded-full px-2 py-0.5 font-semibold text-strawberry-ink hover:underline"
						>
							Undo
						</button>
					</div>
				) : null}
			</div>
		</main>
	);
}

/**
 * The desktop row's trailing control. Filtering is the whole-row action a user
 * clicks constantly, so unfollow — destructive and rare — must NOT sit on that
 * same click path. We keep a quiet, always-visible "⋯" in the trailing slot
 * (discoverable for pointer + keyboard, no hover-gating) that opens a small
 * popover with an inline "Unfollow {title}?" confirm. Two deliberate steps on a
 * separate target, so the cursor's filtering motion can never delete a feed.
 * Focus opens on the dismiss button, so a stray Enter/Space cancels.
 */
function UnfollowControl({
	title,
	onConfirm,
}: {
	title: string;
	onConfirm: () => void;
}) {
	const [open, setOpen] = useState(false);
	return (
		<PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
			<PopoverPrimitive.Trigger asChild>
				<button
					type="button"
					aria-label={`More actions for ${title}`}
					className="focus-scoop flex size-9 shrink-0 items-center justify-center rounded-full text-cocoa-soft opacity-60 transition hover:bg-cocoa/5 hover:text-foreground hover:opacity-100 focus-visible:opacity-100 data-[state=open]:bg-cocoa/5 data-[state=open]:opacity-100"
				>
					<MoreHorizontal className="size-4" aria-hidden />
				</button>
			</PopoverPrimitive.Trigger>
			<PopoverPrimitive.Portal>
				<PopoverPrimitive.Content
					side="bottom"
					align="end"
					sideOffset={6}
					className="melt-in z-50 flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2 text-sm text-foreground shadow-lg"
				>
					<span className="whitespace-nowrap">
						Unfollow <span className="font-semibold">{title}</span>?
					</span>
					{/* Dismiss first so it takes the popover's initial focus. */}
					<button
						type="button"
						onClick={() => setOpen(false)}
						aria-label="Keep following"
						className="focus-scoop flex size-7 shrink-0 items-center justify-center rounded-full text-cocoa-soft transition hover:bg-cocoa/5 hover:text-foreground"
					>
						<X className="size-4" aria-hidden />
					</button>
					<button
						type="button"
						onClick={() => {
							setOpen(false);
							onConfirm();
						}}
						aria-label={`Unfollow ${title}`}
						className="focus-scoop flex size-7 shrink-0 items-center justify-center rounded-full bg-strawberry/15 text-strawberry-ink transition hover:bg-strawberry/25"
					>
						<Check className="size-4" aria-hidden />
					</button>
				</PopoverPrimitive.Content>
			</PopoverPrimitive.Portal>
		</PopoverPrimitive.Root>
	);
}

/**
 * The small-screen counterpart to the flavor sidebar: a single horizontally
 * scrolling row of flavor "scoops" instead of a tall list that buries the feed.
 *
 * Filtering and unfollowing are kept deliberately separate so a filter tap can
 * never quietly unfollow a feed (the bug the sidebar's hover-only X had on
 * touch). Tapping a chip filters; an explicit Edit toggle flips the row into a
 * manage mode where the whole chip becomes "unfollow this flavor".
 */
function FlavorStrip({
	subscriptions,
	feedById,
	selected,
	onToggle,
	onClear,
	onUnfollow,
	onAdd,
	onShare,
}: {
	subscriptions: Subscription[];
	feedById: Map<string, Feed>;
	selected: Set<string>;
	onToggle: (id: string) => void;
	onClear: () => void;
	onUnfollow: (id: string) => void;
	onAdd: () => void;
	onShare: () => void;
}) {
	const [editing, setEditing] = useState(false);
	const showingAll = selected.size === 0;

	return (
		<div className="mb-6 lg:hidden">
			<div className="mb-2 flex items-center justify-between">
				<h2 className="kicker">
					Your flavors{" "}
					<span className="font-normal text-cocoa-soft">
						{subscriptions.length}
					</span>
				</h2>
				<button
					type="button"
					onClick={() => setEditing((e) => !e)}
					aria-pressed={editing}
					className="focus-scoop inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-cocoa-soft transition-colors hover:text-foreground"
				>
					{editing ? (
						<>
							<Check className="size-3.5" aria-hidden />
							Done
						</>
					) : (
						<>
							<Pencil className="size-3.5" aria-hidden />
							Edit
						</>
					)}
				</button>
			</div>

			<div className="flavor-strip -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
				{!editing ? (
					<button
						type="button"
						onClick={onClear}
						aria-pressed={showingAll}
						data-active={showingAll}
						style={{ "--flavor": "var(--strawberry)" } as React.CSSProperties}
						className="flavor-pill shrink-0"
					>
						<Sparkles className="size-3.5 shrink-0" aria-hidden />
						All
					</button>
				) : null}

				{/* One chip; edit mode only swaps the handler, label, the trailing
				    X, and the destructive tint — filtering vs unfollowing. */}
				{subscriptions.map((sub) => {
					const title = feedById.get(sub.id)?.title ?? "Loading…";
					const active = selected.has(sub.id);
					return (
						<button
							key={sub.id}
							type="button"
							onClick={() => (editing ? onUnfollow(sub.id) : onToggle(sub.id))}
							aria-pressed={editing ? undefined : active}
							data-active={editing ? undefined : active}
							aria-label={editing ? `Unfollow ${title}` : `Filter by ${title}`}
							style={{ "--flavor": sub.flavor } as React.CSSProperties}
							className={`flavor-pill shrink-0${editing ? " flavor-pill--remove" : ""}`}
						>
							<span className="flavor-dot shrink-0" />
							<span className="max-w-[10rem] truncate">{title}</span>
							{editing ? <X className="size-3.5 shrink-0" aria-hidden /> : null}
						</button>
					);
				})}

				{!editing ? (
					<>
						<button
							type="button"
							onClick={onAdd}
							className="flavor-pill flavor-pill--ghost shrink-0"
						>
							<Plus className="size-3.5 shrink-0" aria-hidden />
							Add
						</button>
						<button
							type="button"
							onClick={onShare}
							aria-label="Share my flavors"
							className="flavor-pill flavor-pill--ghost shrink-0"
						>
							<Share2 className="size-3.5 shrink-0" aria-hidden />
							Share
						</button>
					</>
				) : null}
			</div>
		</div>
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
				aria-label="Search every flavor, or paste a feed URL"
				placeholder="Search every flavor, or paste a feed URL…"
				value={query}
				onValueChange={setQuery}
			/>
			{error ? (
				<p
					role="alert"
					className="border-border border-b px-4 py-2 text-sm text-strawberry-ink"
				>
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
							<ArrowLeft className="size-4" aria-hidden />
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
			<ChevronRight className="size-4 shrink-0 text-cocoa-soft" aria-hidden />
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
					<Loader2 className="size-4 animate-spin" aria-label="Adding…" />
				) : added ? (
					<Check
						className="size-4 text-accent-foreground"
						aria-label="Already added"
					/>
				) : (
					<Plus className="size-4" aria-hidden />
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
