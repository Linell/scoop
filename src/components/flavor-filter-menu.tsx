import { Check, ChevronDown, Sparkles } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useState } from "react";
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "#/components/ui/command";
import type { Subscription } from "#/lib/subscriptions";
import type { Feed } from "#/lib/types";

/**
 * The feed's flavor filter — a compact dropdown multiselect that replaced the
 * old "Your flavors" sidebar. Filtering is the *only* job here: managing
 * subscriptions (add / unfollow / share) now lives on the Settings page, so a
 * tap in this menu can never delete a feed. An empty selection means "all
 * flavors"; toggling rows keeps the popover open so you can pick several.
 */
export function FlavorFilterMenu({
	subscriptions,
	feedById,
	selected,
	onToggle,
	onClear,
}: {
	subscriptions: Subscription[];
	feedById: Map<string, Feed>;
	selected: Set<string>;
	onToggle: (id: string) => void;
	onClear: () => void;
}) {
	const [open, setOpen] = useState(false);
	const showingAll = selected.size === 0;
	const selectedSubs = subscriptions.filter((s) => selected.has(s.id));

	const label = showingAll
		? "All flavors"
		: selectedSubs.length === 1
			? (feedById.get(selectedSubs[0].id)?.title ?? "1 flavor")
			: `${selectedSubs.length} flavors`;

	return (
		<PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
			<PopoverPrimitive.Trigger asChild>
				<button
					type="button"
					aria-label={`Filter by flavor. ${label} shown.`}
					className="focus-scoop inline-flex min-w-0 max-w-[14rem] items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm text-foreground shadow-sm transition-colors hover:border-strawberry data-[state=open]:border-strawberry"
				>
					{showingAll ? (
						<Sparkles
							className="size-4 shrink-0 text-strawberry-ink"
							aria-hidden
						/>
					) : (
						<span className="flavor-chip__dots shrink-0">
							{selectedSubs.slice(0, 3).map((s) => (
								<span
									key={s.id}
									className="flavor-dot"
									style={{ "--flavor": s.flavor } as React.CSSProperties}
								/>
							))}
						</span>
					)}
					<span className="truncate">{label}</span>
					<ChevronDown
						className="ml-auto size-4 shrink-0 text-cocoa-soft"
						aria-hidden
					/>
				</button>
			</PopoverPrimitive.Trigger>
			<PopoverPrimitive.Portal>
				<PopoverPrimitive.Content
					align="end"
					sideOffset={6}
					className="melt-in z-50 w-72 overflow-hidden rounded-2xl border border-border bg-popover shadow-lg"
				>
					<Command>
						<CommandInput placeholder="Filter flavors…" />
						<CommandList>
							<CommandEmpty>No flavors match.</CommandEmpty>
							<CommandItem
								value="All flavors"
								onSelect={onClear}
								className="gap-3"
							>
								<Sparkles
									className="size-4 shrink-0 text-strawberry-ink"
									aria-hidden
								/>
								<span className="truncate">All flavors</span>
								{showingAll ? (
									<Check className="ml-auto size-4 shrink-0" aria-hidden />
								) : null}
							</CommandItem>
							{subscriptions.map((sub) => {
								const title = feedById.get(sub.id)?.title ?? "Loading…";
								const active = selected.has(sub.id);
								return (
									<CommandItem
										key={sub.id}
										value={title}
										onSelect={() => onToggle(sub.id)}
										className="gap-3"
										style={{ "--flavor": sub.flavor } as React.CSSProperties}
									>
										<span className="flavor-dot shrink-0" />
										<span className="truncate">{title}</span>
										{active ? (
											<Check className="ml-auto size-4 shrink-0" aria-hidden />
										) : null}
									</CommandItem>
								);
							})}
						</CommandList>
					</Command>
				</PopoverPrimitive.Content>
			</PopoverPrimitive.Portal>
		</PopoverPrimitive.Root>
	);
}
