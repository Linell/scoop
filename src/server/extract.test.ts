import { afterEach, describe, expect, it, vi } from "vitest";
import type { Story } from "#/lib/types";
import { enrichStory } from "#/server/extract";

/**
 * Exercises enrichStory end-to-end with a mocked global fetch: confirms HTML
 * extraction, the reader-proxy fallback for thin/blocked pages, HN comment
 * flattening, the both-locations id detection, size caps, and the best-effort
 * error fallback. No network — fetch is stubbed.
 */

const story = (over: Partial<Story> = {}): Story => ({
	id: "s1",
	feedId: "f1",
	url: "https://example.com/article",
	title: "Title",
	author: null,
	content: null,
	publishedAt: 0,
	summary: null,
	...over,
});

const htmlResponse = (body: string) =>
	new Response(body, { headers: { "content-type": "text/html" } });
const jsonResponse = (obj: unknown) =>
	new Response(JSON.stringify(obj), {
		headers: { "content-type": "application/json" },
	});
const textResponse = (body: string) =>
	new Response(body, { headers: { "content-type": "text/plain" } });

const isReader = (input: RequestInfo | URL) =>
	String(input).includes("r.jina.ai");

// Enough prose to clear MIN_ARTICLE_CHARS so the direct fetch is taken as-is
// and the reader fallback stays dormant.
const longProse = (phrase: string) => phrase.repeat(20);

afterEach(() => vi.restoreAllMocks());

describe("enrichStory article extraction", () => {
	it("pulls body prose and drops script/style/head/nav/footer", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			htmlResponse(`<html><head><title>HEADTITLE</title>
				<style>.x{color:red}</style></head>
				<body><nav>NAVLINK</nav><script>tracker()</script>
				<article><p>${longProse("The real article body &amp; more. ")}</p></article>
				<footer>FOOTERJUNK</footer></body></html>`),
		);

		const { articleText } = await enrichStory(story());
		expect(articleText).toContain("The real article body & more.");
		expect(articleText).not.toContain("tracker");
		expect(articleText).not.toContain("color:red");
		expect(articleText).not.toContain("NAVLINK");
		expect(articleText).not.toContain("FOOTERJUNK");
		expect(articleText).not.toContain("HEADTITLE");
		// Direct fetch had enough text — the reader fallback must not fire.
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("falls back to the reader proxy when the direct fetch is blocked", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (input) => {
				if (isReader(input))
					return textResponse("Clean article text recovered by the reader.");
				// Simulate a bot-block: a non-OK response yields no usable text.
				return new Response("Forbidden", { status: 403 });
			});

		const { articleText } = await enrichStory(story());
		expect(articleText).toBe("Clean article text recovered by the reader.");
		expect(fetchMock).toHaveBeenCalledWith(
			"https://r.jina.ai/https://example.com/article",
			expect.anything(),
		);
	});

	it("falls back to the reader for JS-only pages with no readable body", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			if (isReader(input)) return textResponse(longProse("Rendered text. "));
			return htmlResponse(`<body><div id="root"></div></body>`);
		});

		const { articleText } = await enrichStory(story());
		expect(articleText).toContain("Rendered text.");
	});

	it("returns empty when the page is non-HTML and the reader also fails", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			if (isReader(input)) return new Response("nope", { status: 502 });
			return new Response("%PDF-1.7 ...", {
				headers: { "content-type": "application/pdf" },
			});
		});
		const { articleText } = await enrichStory(story());
		expect(articleText).toBe("");
	});

	it("caps the article text length", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			htmlResponse(`<body>${"word ".repeat(5000)}</body>`),
		);
		const { articleText } = await enrichStory(story());
		expect(articleText.length).toBeLessThanOrEqual(6000);
	});

	it("returns empty (does not throw) when every fetch fails", async () => {
		vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
		const { articleText, hnComments } = await enrichStory(story());
		expect(articleText).toBe("");
		expect(hnComments).toBe("");
	});
});

describe("enrichStory HN comments", () => {
	const thread = {
		children: [
			{ text: "<p>Top &amp; level</p>", children: [{ text: "nested reply" }] },
			{ text: "Second top comment", children: null },
			{ text: null, children: [{ text: "child of deleted parent" }] },
		],
	};

	it("fetches comments when the HN id is in story.content (external url)", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (input) => {
				const url = String(input);
				if (url.includes("hn.algolia.com")) return jsonResponse(thread);
				return htmlResponse(`<body>${longProse("article body ")}</body>`);
			});

		const { hnComments } = await enrichStory(
			story({
				url: "https://example.com/external",
				content: "Comments URL: https://news.ycombinator.com/item?id=999",
			}),
		);

		expect(fetchMock).toHaveBeenCalledWith(
			"https://hn.algolia.com/api/v1/items/999",
			expect.anything(),
		);
		expect(hnComments).toContain("Comment 1: Top & level");
		expect(hnComments).toContain("Second top comment");
		expect(hnComments).toContain("child of deleted parent");
		expect(hnComments).toContain("nested reply");
	});

	it("detects the HN id in story.url too", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(jsonResponse(thread));
		await enrichStory(
			story({ url: "https://news.ycombinator.com/item?id=42", content: null }),
		);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://hn.algolia.com/api/v1/items/42",
			expect.anything(),
		);
	});

	it("leaves comments empty for non-HN stories", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(
				htmlResponse(`<body>${longProse("just an article ")}</body>`),
			);
		const { hnComments } = await enrichStory(story({ content: "no thread" }));
		expect(hnComments).toBe("");
		// Direct fetch sufficed (no reader fallback) and there was no Algolia call.
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
