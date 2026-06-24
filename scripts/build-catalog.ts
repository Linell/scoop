/**
 * Build the feed-discovery catalog from plenaryapp/awesome-rss-feeds, layered
 * with our own hand-picked feeds in `scripts/curated-feeds.json`.
 *
 * One-shot generator: downloads the categorized OPML files, parses them with
 * the same fast-xml-parser config the runtime uses, merges in the curated
 * feeds (which win on URL collisions and can add new categories like Baseball
 * and American Football), dedupes by normalized URL, and writes a committed
 * `src/data/catalog.json`. Re-run with `pnpm build-catalog` whenever you want
 * to refresh the bundled catalog — the app never touches GitHub at runtime.
 */

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";
import { normalizeUrl } from "../src/lib/url.ts";
import type { SeedFeed } from "../src/lib/types.ts";

const REPO = "plenaryapp/awesome-rss-feeds";
const DIR = "recommended/with_category";
const USER_AGENT = "Scoop catalog builder (+https://github.com/inngest)";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "src", "data", "catalog.json");
const CURATED = join(here, "curated-feeds.json");

// Mirror the runtime parser: keep attributes, prefix them with @_.
const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	trimValues: true,
});

type Outline = {
	"@_text"?: string;
	"@_title"?: string;
	"@_xmlUrl"?: string;
	"@_htmlUrl"?: string;
	"@_description"?: string;
	outline?: Outline | Outline[];
};

function asArray<T>(value: T | T[] | undefined | null): T[] {
	if (value == null) return [];
	return Array.isArray(value) ? value : [value];
}

/** A GitHub contents-API entry; we only care about OPML download URLs. */
type GhEntry = { name: string; download_url: string };

async function listOpmlFiles(): Promise<GhEntry[]> {
	const api = `https://api.github.com/repos/${REPO}/contents/${DIR}`;
	const res = await fetch(api, {
		headers: { "user-agent": USER_AGENT, accept: "application/vnd.github+json" },
	});
	if (!res.ok) {
		throw new Error(`GitHub listing failed: ${res.status} ${res.statusText}`);
	}
	const entries = (await res.json()) as GhEntry[];
	return entries.filter((e) => e.name.toLowerCase().endsWith(".opml"));
}

/** Pull every feed outline (with an xmlUrl) out of one OPML document. */
function feedsFromOpml(xml: string, category: string): SeedFeed[] {
	const doc = parser.parse(xml) as {
		opml?: { body?: { outline?: Outline | Outline[] } };
	};
	const top = asArray(doc.opml?.body?.outline);

	// Outlines are either feed leaves (have xmlUrl) or category groups whose
	// children are the feeds. Walk one level of nesting and collect the leaves.
	const leaves: Outline[] = [];
	for (const node of top) {
		if (node["@_xmlUrl"]) leaves.push(node);
		else leaves.push(...asArray(node.outline).filter((c) => c["@_xmlUrl"]));
	}

	return leaves.map((o) => ({
		title: (o["@_title"] || o["@_text"] || "Untitled feed").trim(),
		url: o["@_xmlUrl"] as string,
		siteUrl: o["@_htmlUrl"]?.trim() || null,
		description: o["@_description"]?.trim() || null,
		category,
	}));
}

async function main() {
	const files = await listOpmlFiles();
	console.log(`Found ${files.length} OPML files.`);

	const byUrl = new Map<string, SeedFeed>();
	for (const file of files) {
		const category = file.name.replace(/\.opml$/i, "");
		const res = await fetch(file.download_url, {
			headers: { "user-agent": USER_AGENT },
		});
		if (!res.ok) {
			console.warn(`  skip ${file.name}: ${res.status}`);
			continue;
		}
		const feeds = feedsFromOpml(await res.text(), category);
		for (const feed of feeds) {
			// Dedupe on the same normalized URL the runtime keys feeds by, so a
			// feed listed under two categories collapses to its first sighting.
			const key = normalizeUrl(feed.url);
			if (!byUrl.has(key)) byUrl.set(key, feed);
		}
		console.log(`  ${category}: ${feeds.length} feeds`);
	}

	// Layer our curated picks on top. These overwrite any awesome-rss-feeds
	// entry sharing a normalized URL, so a hand-written title/description/
	// category wins over the upstream one.
	const curated = JSON.parse(await readFile(CURATED, "utf8")) as SeedFeed[];
	for (const feed of curated) {
		byUrl.set(normalizeUrl(feed.url), feed);
	}
	console.log(`  curated: ${curated.length} feeds`);

	const catalog = [...byUrl.values()].sort(
		(a, b) =>
			a.category.localeCompare(b.category) || a.title.localeCompare(b.title),
	);

	await mkdir(dirname(OUT), { recursive: true });
	await writeFile(OUT, `${JSON.stringify(catalog, null, "\t")}\n`);
	console.log(`Wrote ${catalog.length} feeds to ${OUT}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
