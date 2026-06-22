import { createFileRoute } from "@tanstack/react-router";
import { Check, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { useSubscriptions } from "#/lib/subscriptions";

export const Route = createFileRoute("/about")({ component: About });

function About() {
	const { subscriptions, hydrated, clear } = useSubscriptions();
	const [cleared, setCleared] = useState(false);

	const reset = () => {
		clear();
		setCleared(true);
	};

	return (
		<main className="mx-auto w-full max-w-2xl px-4 pb-24">
			<section className="melt-in py-10 sm:py-14">
				<p className="kicker">About</p>
				<h1 className="scoop-title mt-3 text-[2rem] text-foreground sm:text-5xl">
					What's the scoop?
				</h1>

				<div className="mt-6 space-y-4 text-cocoa-soft leading-relaxed">
					<p>
						Scoop is a tiny RSS reader demo churned on Cloudflare Workers + D1,
						with Inngest running an AI pipeline that summarizes each fresh scoop
						(and, soon, scores them for you).
					</p>
					<p>
						Flavors (feeds) and their scoops (stories) live in a shared catalog
						in the database. The flavors you've subscribed to are kept right
						here in your browser's localStorage — no sign-up, no sprinkles.
					</p>
				</div>

				<div className="whip-card mt-8 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
					<div className="min-w-0">
						<p className="font-semibold text-foreground text-sm">
							Wipe your flavors
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
								<Check className="size-4" />
								Cleared
							</>
						) : (
							<>
								<Trash2 className="size-4" />
								Reset local storage
							</>
						)}
					</Button>
				</div>
			</section>
		</main>
	);
}
