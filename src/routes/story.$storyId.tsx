import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Check, ExternalLink, Link2, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import { useIsAdmin } from "#/lib/admin";
import { FLAVORS } from "#/lib/subscriptions";
import { relativeTime } from "#/lib/time";
import { hashId, storyClickHref } from "#/lib/url";
import type { StoryDetail } from "#/server/feeds";
import { getStory, resummarizeStory } from "#/server/feeds";

export const Route = createFileRoute("/story/$storyId")({
	// Fetch on the server so the page (and its summary) is there on first paint.
	loader: ({ params }) => getStory({ data: params.storyId }),
	// Title the browser tab (and link previews) with the story itself.
	head: ({ loaderData }) => {
		const story = loaderData?.story;
		if (!story) return { meta: [{ title: "Not found — Scoop" }] };
		const meta: Array<Record<string, string>> = [
			{ title: `${story.title} — Scoop` },
		];
		if (story.summary)
			meta.push({ name: "description", content: story.summary });
		return { meta };
	},
	component: StoryPage,
});

// Poll cadence + ceiling while a resummarize runs. The job fans out through
// Inngest, so we wait for the new summary to land rather than block the click.
const POLL_INTERVAL_MS = 2500;
const POLL_MAX_TRIES = 16;

/** Stable flavor color for a feed, mirroring the per-user dots elsewhere. */
function flavorForFeed(feedId: string): string {
	const n = Number.parseInt(hashId(feedId), 36);
	return FLAVORS[n % FLAVORS.length];
}

function StoryPage() {
	const detail = Route.useLoaderData();

	if (!detail) {
		return (
			<main
				id="main-content"
				className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-3xl flex-col items-center justify-center px-4 py-12 text-center"
			>
				<p className="text-cocoa-soft">
					We couldn't find that scoop — it may have melted away.
				</p>
				<Link
					to="/"
					className="focus-scoop mt-6 inline-flex items-center gap-2 rounded-md font-semibold text-sm text-strawberry-ink no-underline"
				>
					<ArrowLeft className="size-4" />
					Back to your scoops
				</Link>
			</main>
		);
	}

	return <StoryView detail={detail} />;
}

/** Copy this story's URL, morphing the label to "Copied!" for a beat — reuses
 * the same Check-morph pattern as the About page's reset button. */
function CopyLinkButton() {
	const [copied, setCopied] = useState(false);

	const onCopy = async () => {
		try {
			await navigator.clipboard.writeText(window.location.href);
			setCopied(true);
			setTimeout(() => setCopied(false), 1600);
		} catch {
			// Clipboard may be unavailable (insecure context); fail quietly.
		}
	};

	return (
		<Button
			variant="outline"
			onClick={onCopy}
			className="rounded-full"
			aria-label={copied ? "Link copied" : "Copy link to this scoop"}
		>
			{copied ? (
				<>
					<Check className="size-4" aria-hidden />
					Copied!
				</>
			) : (
				<>
					<Link2 className="size-4" aria-hidden />
					Copy link
				</>
			)}
		</Button>
	);
}

function StoryView({ detail }: { detail: StoryDetail }) {
	const { story, feed } = detail;
	const isAdmin = useIsAdmin();
	const flavor = flavorForFeed(story.feedId);

	const [summary, setSummary] = useState<string | null>(story.summary);
	const [working, setWorking] = useState(false);
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);

	const onResummarize = async () => {
		if (working) return;
		setWorking(true);
		const prev = summary;
		setSummary(null); // optimistic: flip the card back to "churning"

		await resummarizeStory({ data: story.id }).catch(() => {});

		// Poll until the regenerated summary lands (or we run out of patience).
		let tries = 0;
		const poll = async () => {
			if (!alive.current) return;
			tries += 1;
			const fresh = await getStory({ data: story.id }).catch(() => null);
			const next = fresh?.story.summary ?? null;
			if (!alive.current) return;
			if (next && next !== prev) {
				setSummary(next);
				setWorking(false);
				return;
			}
			if (tries >= POLL_MAX_TRIES) {
				setSummary(next ?? prev);
				setWorking(false);
				return;
			}
			setTimeout(poll, POLL_INTERVAL_MS);
		};
		setTimeout(poll, POLL_INTERVAL_MS);
	};

	return (
		<main
			id="main-content"
			className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-3xl flex-col px-4 py-12"
		>
			<Link
				to="/"
				className="focus-scoop inline-flex items-center gap-2 self-start rounded-md text-cocoa-soft text-sm no-underline transition-colors hover:text-foreground"
			>
				<ArrowLeft className="size-4" />
				Back to your scoops
			</Link>

			<article className="whip-card melt-in mt-5 overflow-hidden">
				<div
					className="flavor-band h-2 w-full"
					style={{ "--flavor": flavor } as React.CSSProperties}
				/>
				<div className="flex flex-col gap-5 p-6 sm:p-8">
					<div className="flex flex-wrap items-center gap-2 text-cocoa-soft text-sm">
						<span
							className="flavor-dot shrink-0"
							style={{ "--flavor": flavor } as React.CSSProperties}
						/>
						<span className="truncate">{feed?.title ?? "Feed"}</span>
						{story.author ? (
							<>
								<span aria-hidden>·</span>
								<span className="truncate">{story.author}</span>
							</>
						) : null}
						<span aria-hidden>·</span>
						<span>{relativeTime(story.publishedAt)}</span>
					</div>

					<h1 className="scoop-title text-2xl text-foreground leading-[1.12] sm:text-4xl">
						{story.title}
					</h1>

					{/* Announce the summary swap (incl. resummarize) to screen readers. */}
					<div aria-live="polite" aria-busy={working}>
						<p className="kicker">The scoop</p>
						{summary ? (
							<p className="scoop-readable mt-2 text-base text-cocoa-soft">
								{summary}
							</p>
						) : (
							<div className="mt-3 flex items-center gap-3 text-cocoa-soft italic">
								<span className="scoop-thinking" aria-hidden="true">
									<i />
									<i />
									<i />
								</span>
								<span>Scoop is still churning this one…</span>
							</div>
						)}
					</div>

					<div className="flex flex-wrap items-center gap-3 pt-1">
						<a
							href={storyClickHref(story.id, "story")}
							target="_blank"
							rel="noreferrer"
							aria-label="Read the original article (opens in a new tab)"
							className="focus-scoop inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 font-semibold text-primary-foreground text-sm no-underline transition-colors hover:bg-primary/90"
						>
							Read the original
							<ExternalLink className="size-4" aria-hidden />
						</a>

						<CopyLinkButton />

						{isAdmin ? (
							<Button
								variant="outline"
								onClick={onResummarize}
								disabled={working}
								className="rounded-full"
							>
								<RefreshCw
									aria-hidden
									className={`size-4 ${working ? "animate-spin" : ""}`}
								/>
								{working ? "Re-scooping…" : "Resummarize"}
							</Button>
						) : null}
					</div>
				</div>
			</article>
		</main>
	);
}
