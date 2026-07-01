import { Link } from "@tanstack/react-router";
import {
	ArrowRight,
	Bookmark,
	BookmarkCheck,
	MessageSquare,
} from "lucide-react";
import { LeadImage } from "#/components/lead-image";
import type { FeedView } from "#/lib/feed-view";
import { getBrowseSession } from "#/lib/session";
import { relativeTime } from "#/lib/time";
import type { Feed, Story } from "#/lib/types";
import { storyClickHref } from "#/lib/url";
import { recordStoryOpen } from "#/server/feeds";

/**
 * Presentational story card. The bookmark's saved state and toggle handler are
 * owned by the parent grid (which holds the saved-id set once for the whole
 * page) — so a card never tracks saved state itself, and saving one story
 * doesn't re-render every other card. The parent fires the durable save signal.
 */
export function ScoopCard({
	story,
	feed,
	flavor,
	index,
	view,
	saved,
	onToggleSave,
}: {
	story: Story;
	feed: Feed | undefined;
	flavor: string;
	index: number;
	view: FeedView;
	saved: boolean;
	onToggleSave: () => void;
}) {
	// Photos view shows a lead image when this story has one. Cards without an
	// image render the plain text layout, so a mixed feed reads as finished cards
	// (the grid stretches them to equal height) rather than gaps.
	const showImage = view === "photos" && Boolean(story.imageUrl);

	return (
		// A button can't nest inside the card's <Link> (anchor) — that's invalid
		// HTML — so we wrap both in a relative container and float the bookmark as
		// an absolutely-positioned sibling over the card, not a descendant of it.
		<div
			className="relative h-full"
			style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
		>
			<button
				type="button"
				onClick={onToggleSave}
				aria-pressed={saved}
				aria-label={saved ? "Saved" : "Save for later"}
				className="focus-scoop absolute top-2.5 right-2.5 z-10 inline-flex size-9 items-center justify-center rounded-full bg-card/80 text-cocoa-soft shadow-sm backdrop-blur-sm transition-colors hover:text-strawberry-ink"
			>
				{saved ? (
					<BookmarkCheck className="size-4 text-strawberry-ink" aria-hidden />
				) : (
					<Bookmark className="size-4" aria-hidden />
				)}
			</button>

			{/* A second floated sibling (like the bookmark): an <a> can't nest inside
			    the card's <Link>, so a story with a discussion/comments page gets its
			    Discussion link floated over the card rather than as a descendant. */}
			{story.discussionUrl ? (
				<a
					href={storyClickHref(story.id, "feed", {
						bs: getBrowseSession(),
						target: "discussion",
					})}
					target="_blank"
					rel="noreferrer"
					aria-label="Read the discussion (opens in a new tab)"
					className="focus-scoop absolute right-2.5 bottom-2.5 z-10 inline-flex items-center gap-1.5 rounded-full bg-card/80 px-3 py-1.5 font-semibold text-cocoa-soft text-xs no-underline shadow-sm backdrop-blur-sm transition-colors hover:text-strawberry-ink"
				>
					<MessageSquare className="size-3.5" aria-hidden />
					Discussion
				</a>
			) : null}

			<Link
				to="/story/$storyId"
				params={{ storyId: story.id }}
				// Fire-and-forget the click signal; never block the in-app navigation.
				onClick={() => {
					recordStoryOpen({
						data: { storyId: story.id, browseSession: getBrowseSession() },
					}).catch(() => {});
				}}
				className="whip-card whip-card-hover focus-scoop melt-in group flex h-full flex-col overflow-hidden text-left no-underline"
				style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
			>
				<div
					className="flavor-band h-2 w-full"
					style={{ "--flavor": flavor } as React.CSSProperties}
				/>
				{showImage ? <LeadImage src={story.imageUrl} /> : null}
				<div className="flex flex-1 flex-col gap-3 p-5">
					<div className="flex items-center gap-2">
						<span
							className="flavor-dot shrink-0"
							style={{ "--flavor": flavor } as React.CSSProperties}
						/>
						<span className="truncate text-xs text-cocoa-soft">
							{feed?.title ?? "Feed"}
						</span>
						<span className="ml-auto shrink-0 text-xs text-cocoa-soft">
							{relativeTime(story.publishedAt)}
						</span>
					</div>

					<h3 className="font-semibold text-base text-foreground leading-snug">
						{story.title}
					</h3>

					{story.summary ? (
						<p
							className={`text-sm text-cocoa-soft ${
								showImage ? "line-clamp-2" : "line-clamp-3"
							}`}
						>
							{story.summary}
						</p>
					) : (
						<p className="text-sm text-cocoa-soft italic">
							Scoop is still churning this one…
						</p>
					)}

					<div className="mt-auto flex items-center gap-1.5 pt-1 font-semibold text-sm text-strawberry-ink">
						Read the full scoop
						<ArrowRight
							className="size-4 transition-transform group-hover:translate-x-0.5"
							aria-hidden
						/>
					</div>
				</div>
			</Link>
		</div>
	);
}
