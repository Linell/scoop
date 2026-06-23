import { ArrowLeft, Check, ChevronRight, Loader2, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
	CommandDialog,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "#/components/ui/command";
import { groupByCategory, loadCatalog } from "#/lib/catalog";
import type { CatalogFeed } from "#/lib/types";
import { feedIdForUrl } from "#/lib/url";

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
 *
 * Shared by the home empty-state ("Browse all flavors") and the Settings page's
 * subscription manager — both need the exact same add-a-flavor flow.
 */
export function BrowseFlavorsDialog({
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
