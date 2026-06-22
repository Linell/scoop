import { createFileRoute } from "@tanstack/react-router";
import { recordStoryClick } from "#/inngest/events";
import { getStoryById } from "#/server/db";

/**
 * Outbound click tracker. Every "visit the source" link points here first, so
 * the click becomes a durable signal (scoop/story.clicked) before we 302 to the
 * real article. The destination is looked up from the story id server-side and
 * is never carried in the link, so this can't be turned into an open redirect.
 */
async function trackAndRedirect(
	request: Request,
	storyId: string,
): Promise<Response> {
	const story = await getStoryById(storyId);
	if (!story) return new Response("Unknown story", { status: 404 });

	const params = new URL(request.url).searchParams;
	const from = params.get("from") ?? "unknown";
	const cid = params.get("cid") ?? undefined;

	// Best-effort: a tracking hiccup must never cost the reader their click.
	await recordStoryClick(
		{ storyId: story.id, feedId: story.feedId, url: story.url, from },
		cid,
	).catch(() => {});

	return new Response(null, {
		status: 302,
		headers: { Location: story.url, "Cache-Control": "no-store" },
	});
}

export const Route = createFileRoute("/r/$storyId")({
	server: {
		handlers: {
			GET: ({ request, params }) => trackAndRedirect(request, params.storyId),
		},
	},
});
