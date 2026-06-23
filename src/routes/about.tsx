import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/about")({ component: About });

function About() {
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
						Manage your flavors and feed preferences over on the{" "}
						<Link
							to="/settings"
							className="font-semibold underline underline-offset-4"
						>
							Settings
						</Link>{" "}
						page.
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
			</section>
		</main>
	);
}
