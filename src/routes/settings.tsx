import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	Check,
	ImageIcon,
	MoreHorizontal,
	Plus,
	Share2,
	Trash2,
	Type,
	X,
} from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowseFlavorsDialog } from "#/components/browse-flavors-dialog";
import { ShareDialog } from "#/components/share-dialog";
import { Button } from "#/components/ui/button";
import { voodooLoginUrl } from "#/lib/auth";
import { type FeedView, useFeedView } from "#/lib/feed-view";
import type { Subscription } from "#/lib/flavor";
import { FLAVORS } from "#/lib/flavor";
import type { Feed } from "#/lib/types";
import { useAddFeed } from "#/lib/use-add-feed";
import {
	createList,
	getFeeds,
	getMySubscriptions,
	subscribeFeed,
	unsubscribeFeed,
} from "#/server/feeds";

export const Route = createFileRoute("/settings")({
	beforeLoad: ({ context, location }) => {
		if (!context.user) {
			throw redirect({ href: voodooLoginUrl(location.href) });
		}
	},
	loader: async () => {
		const subs = await getMySubscriptions();
		const feeds = await getFeeds({ data: subs.map((s) => s.feedId) });
		return { subs, feeds };
	},
	component: Settings,
});

function Settings() {
	const { subs, feeds: initialFeeds } = Route.useLoaderData();

	// Local mirror of the server-backed subscription list, so follow/unfollow
	// feels instant — mutations still round-trip through subscribeFeed/
	// unsubscribeFeed underneath. Seeded from the loader, not localStorage.
	const [subscriptions, setSubscriptions] = useState<Subscription[]>(() =>
		subs.map((s) => ({ id: s.feedId, flavor: s.flavor })),
	);
	const [feeds, setFeeds] = useState<Feed[]>(initialFeeds);
	const { view, hydrated: viewHydrated, setView } = useFeedView();

	const [dialogOpen, setDialogOpen] = useState(false);
	const [shareOpen, setShareOpen] = useState(false);
	const [clearing, setClearing] = useState(false);
	const [cleared, setCleared] = useState(false);

	const ids = useMemo(() => subscriptions.map((s) => s.id), [subscriptions]);
	const feedById = useMemo(() => new Map(feeds.map((f) => [f.id, f])), [feeds]);

	// Pull any feed records the current subscription set is missing titles for
	// (e.g. right after a fresh follow). The loader already seeded the initial set.
	useEffect(() => {
		const missing = ids.filter((id) => !feedById.has(id));
		if (missing.length === 0) return;
		let cancelled = false;
		getFeeds({ data: missing }).then((fresh) => {
			if (!cancelled && fresh.length > 0) {
				setFeeds((prev) => [...prev, ...fresh]);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [ids, feedById]);

	const isSubscribed = useCallback(
		(id: string) => subscriptions.some((s) => s.id === id),
		[subscriptions],
	);

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

	// The browse dialog's combined catalog-pick / paste-URL follow handler.
	const { onDialogAdd } = useAddFeed(subscribe);

	// Unfollowing is soft-destructive, so it never happens silently: we stash the
	// removed subscription (and where it sat) and surface an "Undo" toast for a
	// few seconds. Restoring puts the exact flavor back in place.
	const [undo, setUndo] = useState<{
		sub: Subscription;
		index: number;
		title: string;
	} | null>(null);

	const unfollow = useCallback(
		(id: string) => {
			const index = subscriptions.findIndex((s) => s.id === id);
			if (index === -1) return;
			const sub = subscriptions[index];
			setSubscriptions((prev) => prev.filter((s) => s.id !== id));
			unsubscribeFeed({ data: { feedId: id } }).catch(() => {
				setSubscriptions((prev) => {
					if (prev.some((s) => s.id === sub.id)) return prev;
					const next = [...prev];
					next.splice(Math.min(index, next.length), 0, sub);
					return next;
				});
			});
			const title = feedById.get(id)?.title ?? "that flavor";
			setUndo({ sub, index, title });
		},
		[subscriptions, feedById],
	);

	const undoUnfollow = useCallback(() => {
		setUndo((u) => {
			if (u) {
				setSubscriptions((prev) => {
					if (prev.some((s) => s.id === u.sub.id)) return prev;
					const next = [...prev];
					next.splice(Math.min(u.index, next.length), 0, u.sub);
					return next;
				});
				subscribeFeed({
					data: { feedId: u.sub.id, flavor: u.sub.flavor },
				}).catch(() => {});
			}
			return null;
		});
	}, []);

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
	// doesn't re-fire on every subscribe/unsubscribe and mint a fresh row. Read
	// the current ids through a ref and mint whatever is subscribed at click time.
	const idsRef = useRef(ids);
	idsRef.current = ids;
	const createFlavorsLink = useCallback(async (): Promise<string> => {
		const { slug } = await createList({
			data: { kind: "feeds", ids: idsRef.current },
		});
		return `${window.location.origin}/l/${slug}`;
	}, []);

	// Unfollow every flavor at once — the account-backed successor to the old
	// "wipe local storage" button, now that subscriptions live server-side and
	// there's nothing local left to wipe.
	const unfollowAll = async () => {
		setClearing(true);
		const toRemove = subscriptions;
		setSubscriptions([]);
		const results = await Promise.allSettled(
			toRemove.map((s) => unsubscribeFeed({ data: { feedId: s.id } })),
		);
		const failed = toRemove.filter((_, i) => results[i].status === "rejected");
		if (failed.length) {
			setSubscriptions((prev) => [...prev, ...failed]);
		}
		setClearing(false);
		setCleared(true);
	};

	return (
		<main id="main-content" className="mx-auto w-full max-w-2xl px-4 pb-24">
			<section className="melt-in py-10 sm:py-14">
				<p className="kicker">Settings</p>
				<h1 className="scoop-title mt-3 text-[2rem] text-foreground sm:text-5xl">
					Your scoop shop
				</h1>

				{/* Your flavors — the subscription manager. */}
				<div className="mt-8">
					<div className="flex items-center justify-between">
						<h2 className="kicker">Your flavors</h2>
						<span className="text-xs text-cocoa-soft">
							{subscriptions.length}
						</span>
					</div>

					{subscriptions.length === 0 ? (
						<div className="whip-card mt-4 flex flex-col items-center gap-4 p-8 text-center">
							<p className="max-w-[40ch] text-cocoa-soft">
								No flavors yet. Browse the scoop shop to follow your first feed.
							</p>
							<Button
								onClick={() => setDialogOpen(true)}
								className="rounded-full"
							>
								<Plus className="size-4" aria-hidden />
								Add a flavor
							</Button>
						</div>
					) : (
						<>
							<ul className="mt-4 space-y-1">
								{subscriptions.map((sub) => {
									const feed = feedById.get(sub.id);
									return (
										<li key={sub.id}>
											<div
												style={
													{ "--flavor": sub.flavor } as React.CSSProperties
												}
												className="flavor-row flex min-h-11 w-full items-center gap-3 rounded-full px-3 py-2"
											>
												<span className="flavor-dot shrink-0" />
												<span
													title={feed?.title}
													className="min-w-0 flex-1 truncate text-sm text-foreground"
												>
													{feed?.title ?? "Loading…"}
												</span>
												<UnfollowControl
													title={feed?.title ?? "this flavor"}
													onConfirm={() => unfollow(sub.id)}
												/>
											</div>
										</li>
									);
								})}
							</ul>

							<div className="mt-2 flex flex-wrap gap-1">
								<Button
									variant="ghost"
									onClick={() => setDialogOpen(true)}
									className="justify-start rounded-full text-cocoa-soft"
								>
									<Plus className="size-4" aria-hidden />
									Add a flavor
								</Button>
								{subscriptions.length > 0 ? (
									<Button
										variant="ghost"
										onClick={() => setShareOpen(true)}
										className="justify-start rounded-full text-cocoa-soft"
									>
										<Share2 className="size-4" aria-hidden />
										Share my flavors
									</Button>
								) : null}
							</div>
						</>
					)}
				</div>

				{/* Feed view preference — moved here from the About page. */}
				<div className="whip-card mt-8 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
					<div className="min-w-0">
						<p className="font-semibold text-foreground text-sm">
							Show images in your feed
						</p>
						<p className="text-cocoa-soft text-sm">
							Photos adds a lead image to scoops that have one — nice for
							image-heavy flavors. Text keeps the feed minimal.
						</p>
					</div>
					<ViewToggle
						value={view}
						onChange={setView}
						disabled={!viewHydrated}
					/>
				</div>

				{/* Unfollow everything — the account-backed successor to the old
				    "wipe local storage" button. */}
				<div className="whip-card mt-4 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
					<div className="min-w-0">
						<p className="font-semibold text-foreground text-sm">
							Unfollow all your flavors
						</p>
						<p className="text-cocoa-soft text-sm">
							{`Unfollows all ${subscriptions.length} flavor${
								subscriptions.length === 1 ? "" : "s"
							} on your account.`}
						</p>
					</div>
					<Button
						variant="outline"
						onClick={unfollowAll}
						disabled={clearing || cleared || subscriptions.length === 0}
						className="shrink-0 rounded-full"
					>
						{cleared ? (
							<>
								<Check className="size-4" aria-hidden />
								Unfollowed
							</>
						) : (
							<>
								<Trash2 className="size-4" aria-hidden />
								{clearing ? "Unfollowing…" : "Unfollow all"}
							</>
						)}
					</Button>
				</div>
			</section>

			<BrowseFlavorsDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				onAdd={onDialogAdd}
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
 * A feed row's trailing control: a quiet "⋯" that opens a small popover with an
 * inline "Unfollow {title}?" confirm. Two deliberate steps so an unfollow is
 * never a single stray tap. Focus opens on the dismiss button, so a stray
 * Enter/Space cancels.
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

/** A minimal two-segment pill — Text vs Photos — for the feed view preference.
 * Each segment is a real toggle button (aria-pressed), so it reads correctly to
 * assistive tech and matches the pill language used elsewhere in Scoop. */
function ViewToggle({
	value,
	onChange,
	disabled,
}: {
	value: FeedView;
	onChange: (next: FeedView) => void;
	disabled?: boolean;
}) {
	const options: { id: FeedView; label: string; Icon: typeof Type }[] = [
		{ id: "text", label: "Text", Icon: Type },
		{ id: "photos", label: "Photos", Icon: ImageIcon },
	];
	return (
		<div
			role="group"
			aria-label="Feed view"
			className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-card p-1"
		>
			{options.map(({ id, label, Icon }) => {
				const active = value === id;
				return (
					<button
						key={id}
						type="button"
						onClick={() => onChange(id)}
						disabled={disabled}
						aria-pressed={active}
						className={`focus-scoop inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-semibold text-sm transition-colors disabled:opacity-50 ${
							active
								? "bg-secondary text-foreground"
								: "text-cocoa-soft hover:text-foreground"
						}`}
					>
						<Icon className="size-4" aria-hidden />
						{label}
					</button>
				);
			})}
		</div>
	);
}
