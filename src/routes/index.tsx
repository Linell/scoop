import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Plus, Sparkles } from "lucide-react";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";

export const Route = createFileRoute("/")({ component: Home });

const FLAVORS = [
	"var(--strawberry)",
	"var(--mint)",
	"var(--blueberry)",
	"var(--lemon)",
	"var(--taro)",
	"var(--mango)",
];

// Hand-picked so loading feed names read as real titles, not a staircase.
const NAME_WIDTHS = ["70%", "52%", "64%", "46%", "60%", "50%"];

function Home() {
	return (
		<main className="mx-auto w-full max-w-6xl px-4 pb-24">
			{/* Hero */}
			<section className="melt-in py-10 sm:py-14">
				<p className="kicker">Your feeds, scooped</p>
				<h1 className="scoop-title mt-3 text-[2rem] text-foreground sm:text-6xl">
					Today, scooped.
				</h1>
				<p className="mt-4 max-w-[46ch] text-cocoa-soft">
					Scoop reads your feeds and melts each story down to the good part —
					then points you back to the source.
				</p>

				{/* Ask Scoop bar */}
				<Link
					to="/chat"
					className="focus-scoop mt-7 flex max-w-xl items-center gap-3 rounded-2xl border border-border bg-card px-5 py-3.5 no-underline shadow-sm transition-colors hover:border-strawberry"
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
						<span className="text-xs text-cocoa-soft">6</span>
					</div>
					<ul className="mt-4 space-y-1">
						{FLAVORS.map((flavor, i) => (
							<li key={flavor}>
								<button
									type="button"
									className="focus-scoop flex min-h-11 w-full items-center gap-3 rounded-full px-3 py-2 text-left transition-colors hover:bg-secondary"
								>
									<span
										className="flavor-dot shrink-0"
										style={{ "--flavor": flavor } as React.CSSProperties}
									/>
									<Skeleton
										className="h-3.5 rounded-full"
										style={{ width: NAME_WIDTHS[i] }}
									/>
								</button>
							</li>
						))}
					</ul>
					<Button
						variant="ghost"
						className="mt-2 w-full justify-start rounded-full text-cocoa-soft"
					>
						<Plus className="size-4" />
						Add a flavor
					</Button>
				</aside>

				{/* The feed */}
				<section>
					<div className="mb-4 flex items-baseline justify-between">
						<p className="kicker">Fresh scoops</p>
						<span className="text-xs text-cocoa-soft">just churned</span>
					</div>
					<div className="grid gap-5 sm:grid-cols-2">
						{FLAVORS.map((flavor, i) => (
							<ScoopCardSkeleton key={flavor} flavor={flavor} index={i} />
						))}
					</div>
				</section>
			</div>
		</main>
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
		<button
			type="button"
			className="whip-card whip-card-hover focus-scoop melt-in group flex h-full flex-col overflow-hidden text-left"
			style={{ animationDelay: `${index * 60}ms` }}
		>
			<div
				className="flavor-band h-2 w-full"
				style={{ "--flavor": flavor } as React.CSSProperties}
			/>
			<div className="flex flex-1 flex-col gap-4 p-5">
				{/* source · time */}
				<div className="flex items-center gap-2">
					<span
						className="flavor-dot shrink-0"
						style={{ "--flavor": flavor } as React.CSSProperties}
					/>
					<Skeleton className="h-3 w-24 rounded-full" />
					<Skeleton className="ml-auto h-3 w-10 rounded-full" />
				</div>
				{/* headline */}
				<div className="space-y-2">
					<Skeleton className="h-5 w-[92%] rounded-full" />
					<Skeleton className="h-5 w-[64%] rounded-full" />
				</div>
				{/* summary teaser */}
				<div className="space-y-2">
					<Skeleton className="h-3 w-full rounded-full" />
					<Skeleton className="h-3 w-full rounded-full" />
					<Skeleton className="h-3 w-[80%] rounded-full" />
				</div>
				{/* read the full scoop — pinned to bottom so it never drifts */}
				<div className="mt-auto flex items-center gap-1.5 pt-1 font-semibold text-sm text-strawberry-ink">
					Read the full scoop
					<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
				</div>
			</div>
		</button>
	);
}
