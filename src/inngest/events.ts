import { eventType } from "inngest";
import { z } from "zod";
import { inngest } from "./client";

/**
 * Fired once per newly-ingested story. Each event fans out into its own
 * `summarize-story` run, so a slow/failing summary for one story never blocks
 * the others — and later, each run is a natural unit to attach a score to.
 */
export const storyCreated = eventType("scoop/story.created", {
	schema: z.object({ storyId: z.string() }),
});

/** A human asked to regenerate a story's summary; handled by `resummarize-story`. */
export const storyResummarizeRequested = eventType(
	"scoop/story.resummarize.requested",
	{ schema: z.object({ storyId: z.string() }) },
);

/**
 * Regenerate this story's summary now. A dedicated event (rather than re-firing
 * `scoop/story.created`) so the log keeps "created" meaning created.
 */
export const storyResummarize = eventType("scoop/story.resummarize", {
	schema: z.object({ storyId: z.string() }),
});

/**
 * Fired once per feed by the `refresh-feeds` cron. Each event fans out into its
 * own `refresh-feed` run, so a single slow/broken feed retries and scales on
 * its own without blocking the rest of the batch.
 */
export const feedRefreshRequested = eventType("scoop/feed.refresh.requested", {
	schema: z.object({ feedUrl: z.string() }),
});

/**
 * An outbound click on a story, captured by the /r/$storyId redirect. No
 * consumer yet — it's the durable signal scoring will grade later, and (when a
 * conversation id rides along on the send) the click that ties a chat session
 * to the article it drove the reader to.
 */
export const storyClicked = eventType("scoop/story.clicked", {
	schema: z.object({
		storyId: z.string(),
		feedId: z.string(),
		url: z.string(),
		from: z.string(),
		// What the reader actually did: `open` = viewed the in-app show page (a
		// weak signal), `through` = clicked out to the original article (the strong
		// teaser signal). `from` records the surface and can't distinguish these
		// (an outbound link can also carry from:"feed"), so the action is explicit.
		action: z.enum(["open", "through"]),
	}),
});

/**
 * A human rated a story's summary after reading it. Handled by `score-rating`,
 * which maps the rating to a `satisfaction` score and attributes it to the
 * teaser-strategy variant that produced the summary — a human signal alongside
 * the automated judge and clickthrough scores.
 */
export const summaryRated = eventType("scoop/summary.rated", {
	schema: z.object({
		storyId: z.string(),
		rating: z.enum(["good", "oversold", "spoiled"]),
	}),
});

/**
 * A reader saved a story to their reading list. Handled by `score-save` — saving
 * is a strong positive engagement signal (a deliberate "I want to come back to
 * this"), so the reading list pulls double duty as a scoring signal here.
 */
export const storySaved = eventType("scoop/story.saved", {
	schema: z.object({ storyId: z.string() }),
});

/** Best-effort: enqueue a summary job for each new story id. */
export async function queueStorySummaries(storyIds: string[]): Promise<void> {
	if (storyIds.length === 0) return;
	await inngest.send(
		storyIds.map((storyId) => storyCreated.create({ storyId })),
	);
}

/** Ask Scoop to regenerate one story's summary. */
export async function requestResummarize(storyId: string): Promise<void> {
	await inngest.send(storyResummarizeRequested.create({ storyId }));
}

type StoryClick = {
	storyId: string;
	feedId: string;
	url: string;
	from: string;
	action: "open" | "through";
};

/**
 * Record an outbound click. Both ids ride along as dashboard sessions: a
 * `browseSession` so the click joins the rest of this tab's browsing burst, and
 * a `conversationId` (when the click came from chat) so it also shares a session
 * with the chat turn that drove it. `meta` is omitted when neither is present.
 */
export async function recordStoryClick(
	click: StoryClick,
	{
		conversationId,
		browseSession,
	}: { conversationId?: string; browseSession?: string } = {},
): Promise<void> {
	const sessions = {
		...(browseSession && { browse_session: browseSession }),
		...(conversationId && { conversation_id: conversationId }),
	};
	await inngest.send({
		...storyClicked.create(click),
		...(Object.keys(sessions).length > 0 && { meta: { sessions } }),
	});
}

/**
 * Record a human's rating of a story's summary, scored per-variant downstream.
 * A `browseSession` rides along as a session so the rating joins the rest of
 * this tab's browsing burst in the dashboard.
 */
export async function recordSummaryRating(
	storyId: string,
	rating: "good" | "oversold" | "spoiled",
	browseSession?: string,
): Promise<void> {
	await inngest.send({
		...summaryRated.create({ storyId, rating }),
		...(browseSession && {
			meta: { sessions: { browse_session: browseSession } },
		}),
	});
}

/**
 * Record a save to the reading list — a strong positive engagement signal. Both
 * ids ride along as dashboard sessions when present: a `browseSession` so the
 * save joins the rest of this tab's browsing burst, and a `clientId` so it
 * stitches to the returning visitor over time. `meta` is omitted when neither
 * is present.
 */
export async function recordStorySave(
	storyId: string,
	{
		browseSession,
		clientId,
	}: { browseSession?: string; clientId?: string } = {},
): Promise<void> {
	const sessions = {
		...(browseSession && { browse_session: browseSession }),
		...(clientId && { client_id: clientId }),
	};
	await inngest.send({
		...storySaved.create({ storyId }),
		...(Object.keys(sessions).length > 0 && { meta: { sessions } }),
	});
}
