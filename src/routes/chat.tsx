import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, ArrowUp } from "lucide-react";
import { ScoopLogo } from "#/components/scoop-logo";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";

export const Route = createFileRoute("/chat")({ component: Chat });

const CITED = ["var(--strawberry)", "var(--mint)", "var(--blueberry)"];

const TASTES = [
	"What's the biggest story today?",
	"Catch me up in 30 seconds",
	"Anything new worth reading?",
];

function Chat() {
	return (
		<main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-3xl flex-col px-4">
			<div className="flex-1 space-y-8 py-10">
				<header className="melt-in">
					<p className="kicker">Ask Scoop</p>
					<h1 className="scoop-title mt-2 text-2xl text-foreground sm:text-3xl">
						What do you want to know?
					</h1>
					<p className="mt-2 max-w-[52ch] text-cocoa-soft">
						Scoop answers from your feeds and links you to the stories worth the
						click.
					</p>

					{/* Starter prompts */}
					<div className="mt-5 flex flex-wrap gap-2">
						{TASTES.map((taste) => (
							<button
								key={taste}
								type="button"
								className="focus-scoop rounded-full border border-border bg-card px-3.5 py-2 text-sm text-cocoa-soft no-underline shadow-sm transition-colors hover:border-strawberry hover:text-foreground"
							>
								{taste}
							</button>
						))}
					</div>
				</header>

				{/* An answer in progress */}
				<div className="melt-in flex gap-3">
					<div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-card">
						<ScoopLogo className="h-7 w-7" />
					</div>
					<div className="min-w-0 flex-1 space-y-4">
						<div className="max-w-[60ch] space-y-2 pt-1">
							<Skeleton className="h-3.5 w-full rounded-full" />
							<Skeleton className="h-3.5 w-full rounded-full" />
							<Skeleton className="h-3.5 w-[72%] rounded-full" />
						</div>

						<div>
							<p className="kicker mb-2">Worth a click</p>
							<div className="space-y-2.5">
								{CITED.map((flavor) => (
									<CitedScoop key={flavor} flavor={flavor} />
								))}
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* Composer */}
			<div className="sticky bottom-0 -mx-4 border-t border-border bg-background/80 px-4 py-4 backdrop-blur-md">
				<div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm focus-within:border-strawberry">
					<textarea
						rows={1}
						placeholder="Ask Scoop anything…"
						className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2 text-foreground outline-none placeholder:text-cocoa-soft"
					/>
					<Button size="icon" className="size-11 shrink-0 rounded-xl">
						<ArrowUp className="size-4" />
					</Button>
				</div>
				<p className="mt-2 text-center text-xs text-cocoa-soft">
					Scoop gives you the gist — the full scoop always lives at the source.
				</p>
			</div>
		</main>
	);
}

function CitedScoop({ flavor }: { flavor: string }) {
	return (
		<button
			type="button"
			className="whip-card whip-card-hover focus-scoop group flex w-full items-center gap-3 p-3 text-left"
		>
			<span
				className="flavor-dot shrink-0"
				style={{ "--flavor": flavor } as React.CSSProperties}
			/>
			<div className="min-w-0 flex-1 space-y-2">
				<Skeleton className="h-3.5 w-[80%] rounded-full" />
				<Skeleton className="h-3 w-24 rounded-full" />
			</div>
			<ArrowRight className="size-4 shrink-0 text-strawberry-ink transition-transform group-hover:translate-x-0.5" />
		</button>
	);
}
