import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { submitFeed } from "#/server/feeds";

export const Route = createFileRoute("/submit")({ component: Submit });

type Result =
	| { kind: "already"; title: string }
	| { kind: "added"; title: string; category: string | null }
	| { kind: "error"; message: string };

function Submit() {
	const [url, setUrl] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [result, setResult] = useState<Result | null>(null);

	const onSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		const trimmed = url.trim();
		if (!trimmed || submitting) return;
		setSubmitting(true);
		setResult(null);
		try {
			const res = await submitFeed({ data: trimmed });
			if (!res.ok) {
				setResult({ kind: "error", message: res.error });
			} else if (res.already) {
				setResult({ kind: "already", title: res.title });
			} else {
				setResult({
					kind: "added",
					title: res.title,
					category: res.category ?? null,
				});
				// On a successful new catalog entry, clear the box so it's ready for
				// the next one.
				setUrl("");
			}
		} catch {
			setResult({
				kind: "error",
				message: "Something went wrong submitting that feed.",
			});
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<main id="main-content" className="mx-auto w-full max-w-2xl px-4 pb-24">
			<section className="melt-in py-10 sm:py-14">
				<p className="kicker">Submit a flavor</p>
				<h1 className="scoop-title mt-3 text-[2rem] text-foreground sm:text-5xl">
					Add a feed to the scoop shop
				</h1>

				<div className="mt-6 space-y-4 text-cocoa-soft leading-relaxed">
					<p>
						Know a great RSS or Atom feed that isn't in the catalog yet? Drop
						its URL below and we'll catalog it for everyone browsing flavors. No
						account needed — submitting doesn't subscribe you, so head to{" "}
						<Link to="/" className="font-semibold underline underline-offset-4">
							the home page
						</Link>{" "}
						to follow it afterwards.
					</p>
				</div>

				<form
					onSubmit={onSubmit}
					className="whip-card mt-8 flex flex-col gap-4 p-5"
				>
					<label
						htmlFor="feed-url"
						className="font-semibold text-foreground text-sm"
					>
						Feed URL
					</label>
					<div className="flex flex-col gap-3 sm:flex-row">
						<input
							id="feed-url"
							type="url"
							inputMode="url"
							autoComplete="off"
							placeholder="https://example.com/feed.xml"
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							disabled={submitting}
							className="focus-scoop min-w-0 flex-1 rounded-full border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-cocoa-soft disabled:opacity-50"
						/>
						<Button
							type="submit"
							disabled={submitting || url.trim() === ""}
							className="shrink-0 rounded-full"
						>
							{submitting ? (
								<>
									<Loader2 className="size-4 animate-spin" aria-hidden />
									Submitting…
								</>
							) : (
								<>
									<Plus className="size-4" aria-hidden />
									Submit feed
								</>
							)}
						</Button>
					</div>

					<div aria-live="polite" className="min-h-5">
						{result?.kind === "already" ? (
							<p className="text-cocoa-soft text-sm">
								<span className="font-semibold text-foreground">
									{result.title}
								</span>{" "}
								is already in the scoop shop. Find it when you{" "}
								<Link
									to="/"
									className="font-semibold underline underline-offset-4"
								>
									browse flavors
								</Link>
								.
							</p>
						) : result?.kind === "added" ? (
							<p className="text-cocoa-soft text-sm">
								Added{" "}
								<span className="font-semibold text-foreground">
									{result.title}
								</span>{" "}
								to{" "}
								{result.category
									? `the catalog under ${result.category}`
									: "the catalog"}
								! It'll show up for everyone browsing feeds.
							</p>
						) : result?.kind === "error" ? (
							<p role="alert" className="text-sm text-strawberry-ink">
								{result.message}
							</p>
						) : null}
					</div>
				</form>
			</section>
		</main>
	);
}
