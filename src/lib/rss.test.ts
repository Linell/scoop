import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAndParseFeed } from "#/lib/rss";

/**
 * Covers discussion-url extraction across feed formats: the standard RSS 2.0
 * <comments> element (Hacker News, WordPress, …), the Atom rel="replies" link,
 * and the absence of either — which must leave discussionUrl null rather than
 * falling back to the article url. Network is stubbed; no real fetch.
 */

const xmlResponse = (body: string) =>
	new Response(body, { headers: { "content-type": "application/xml" } });

const stubFeed = (body: string) =>
	vi.spyOn(globalThis, "fetch").mockResolvedValue(xmlResponse(body));

afterEach(() => vi.restoreAllMocks());

describe("fetchAndParseFeed discussion url", () => {
	it("reads the RSS <comments> element into discussionUrl", async () => {
		stubFeed(`<?xml version="1.0"?>
			<rss version="2.0"><channel>
				<title>Hacker News</title>
				<link>https://news.ycombinator.com/</link>
				<item>
					<title>With comments</title>
					<link>https://example.com/article</link>
					<comments>https://news.ycombinator.com/item?id=123</comments>
				</item>
				<item>
					<title>Without comments</title>
					<link>https://example.com/plain</link>
				</item>
			</channel></rss>`);

		const { items } = await fetchAndParseFeed("https://hnrss.org/frontpage");

		expect(items[0].url).toBe("https://example.com/article");
		expect(items[0].discussionUrl).toBe(
			"https://news.ycombinator.com/item?id=123",
		);
		// No <comments> must stay null — never fall back to the article url.
		expect(items[1].discussionUrl).toBeNull();
	});

	it('reads the Atom link rel="replies" into discussionUrl', async () => {
		stubFeed(`<?xml version="1.0"?>
			<feed xmlns="http://www.w3.org/2005/Atom">
				<title>Atom feed</title>
				<entry>
					<title>Entry</title>
					<id>tag:example,2026:1</id>
					<link rel="alternate" href="https://example.com/a"/>
					<link rel="replies" href="https://example.com/a/comments"/>
				</entry>
				<entry>
					<title>No replies</title>
					<id>tag:example,2026:2</id>
					<link rel="alternate" href="https://example.com/b"/>
				</entry>
			</feed>`);

		const { items } = await fetchAndParseFeed("https://example.com/atom");

		expect(items[0].url).toBe("https://example.com/a");
		expect(items[0].discussionUrl).toBe("https://example.com/a/comments");
		expect(items[1].discussionUrl).toBeNull();
	});
});
