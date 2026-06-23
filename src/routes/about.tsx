import { createFileRoute } from "@tanstack/react-router";
import { Check, ImageIcon, Trash2, Type } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { type FeedView, useFeedView } from "#/lib/feed-view";
import { useSubscriptions } from "#/lib/subscriptions";

export const Route = createFileRoute("/about")({ component: About });

function About() {
	const { subscriptions, hydrated, clear } = useSubscriptions();
	const { view, hydrated: viewHydrated, setView } = useFeedView();
	const [cleared, setCleared] = useState(false);

	const reset = () => {
		clear();
		setCleared(true);
	};

	return (
		<main id="main-content" className="mx-auto w-full max-w-2xl px-4 pb-24">
			<section className="melt-in py-10 sm:py-14">
				<p className="kicker">About</p>
				<h1 className="scoop-title mt-3 text-[2rem] text-foreground sm:text-5xl">
					What's the scoop?
				</h1>

				<div className="mt-6 space-y-4 text-cocoa-soft leading-relaxed">
					<p>
						Scoop is a RSS reader demo churned on Cloudflare Workers + D1, with{" "}
						<a
							href="https://www.inngest.com"
							target="_blank"
							rel="noreferrer"
							className="font-semibold underline underline-offset-4"
						>
							Inngest
						</a>{" "}
						running an AI pipeline that summarizes each fresh scoop.
					</p>
					<p>
						<span className="font-semibold">Flavors</span> (feeds) and their
						<span className="font-semibold"> scoops</span> (stories) live in a
						shared catalog in the database. The flavors you've subscribed to are
						kept locally on your device - no account or sign up needed!
					</p>
					<p>
						Made with extra sprinkles 🍦 by{" "}
						<a
							href="https://thelinell.com"
							target="_blank"
							rel="noreferrer"
							className="font-semibold underline underline-offset-4"
						>
							Linell Bonnette
						</a>
						.
					</p>
				</div>

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

				<div className="whip-card mt-4 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
					<div className="min-w-0">
						<p className="font-semibold text-foreground text-sm">
							Wipe your Flavors
						</p>
						<p className="text-cocoa-soft text-sm">
							{hydrated
								? `Clears your ${subscriptions.length} subscription${
										subscriptions.length === 1 ? "" : "s"
									} from this browser.`
								: "Clears your subscriptions from this browser."}
						</p>
					</div>
					<Button
						variant="outline"
						onClick={reset}
						disabled={cleared || (hydrated && subscriptions.length === 0)}
						className="shrink-0 rounded-full"
					>
						{cleared ? (
							<>
								<Check className="size-4" aria-hidden />
								Cleared
							</>
						) : (
							<>
								<Trash2 className="size-4" aria-hidden />
								Reset Local Storage
							</>
						)}
					</Button>
				</div>
			</section>
		</main>
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
