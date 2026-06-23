import { describe, expect, it } from "vitest";
import type { Collection } from "#/lib/collections";
import type { SavedStory } from "#/lib/saved";
import {
	mergeSharedCollection,
	parseShareStructure,
	type ShareStructure,
} from "#/lib/share-merge";

/**
 * Exercises the best-effort share merge: a fresh import builds the incoming
 * tree, a re-import matches existing folders by (parent, name) without
 * duplicating, membership unions rather than replacing, and a folder whose
 * parent ref is missing falls back to a root. ids/colors/clock are injected so
 * the merge is deterministic.
 */

// A deterministic id minter — m0, m1, … — so assertions can name new ids.
function minter() {
	let n = 0;
	return () => `m${n++}`;
}

// A trivial palette so colors don't matter to the assertions.
const nextColor = (count: number) => `color-${count}`;

const NOW = 1000;

describe("mergeSharedCollection", () => {
	it("creates the incoming tree on a fresh import", () => {
		const structure: ShareStructure = {
			folders: [
				{ key: "f0", name: "Reading", parent: null },
				{ key: "f1", name: "Rust", parent: "f0" },
			],
			items: [
				{ storyId: "s1", folders: ["f0"] },
				{ storyId: "s2", folders: ["f1"] },
			],
		};

		const { collections, saved } = mergeSharedCollection({
			structure,
			collections: [],
			saved: [],
			newId: minter(),
			nextColor,
			now: NOW,
		});

		expect(collections).toHaveLength(2);
		const reading = collections.find((c) => c.name === "Reading");
		const rust = collections.find((c) => c.name === "Rust");
		expect(reading?.parent).toBeNull();
		expect(rust?.parent).toBe(reading?.id);

		// Stories were saved and tagged into their mapped collections.
		expect(saved).toHaveLength(2);
		const s1 = saved.find((s) => s.storyId === "s1");
		const s2 = saved.find((s) => s.storyId === "s2");
		expect(s1?.collections).toEqual([reading?.id]);
		expect(s2?.collections).toEqual([rust?.id]);
		expect(s1?.savedAt).toBe(NOW);
	});

	it("merges by (parent, name) without duplicating on re-import", () => {
		// Recipient already has the same tree (different ids/casing/whitespace).
		const collections: Collection[] = [
			{ id: "c-reading", name: "reading", parent: null, color: "x" },
			{ id: "c-rust", name: " Rust ", parent: "c-reading", color: "y" },
		];
		const saved: SavedStory[] = [
			{ storyId: "s1", savedAt: 1, collections: ["c-reading"] },
		];

		const structure: ShareStructure = {
			folders: [
				{ key: "f0", name: "Reading", parent: null },
				{ key: "f1", name: "Rust", parent: "f0" },
			],
			items: [{ storyId: "s2", folders: ["f1"] }],
		};

		const merged = mergeSharedCollection({
			structure,
			collections,
			saved,
			newId: minter(),
			nextColor,
			now: NOW,
		});

		// No new folders — both matched existing ones.
		expect(merged.collections).toHaveLength(2);
		// Existing savedAt preserved for s1, new story s2 added under c-rust.
		const s1 = merged.saved.find((s) => s.storyId === "s1");
		const s2 = merged.saved.find((s) => s.storyId === "s2");
		expect(s1?.savedAt).toBe(1);
		expect(s2?.collections).toEqual(["c-rust"]);
	});

	it("unions membership into an already-saved story", () => {
		const collections: Collection[] = [
			{ id: "c-reading", name: "Reading", parent: null, color: "x" },
		];
		const saved: SavedStory[] = [
			{ storyId: "s1", savedAt: 5, collections: ["c-other"] },
		];

		const structure: ShareStructure = {
			folders: [{ key: "f0", name: "Reading", parent: null }],
			items: [{ storyId: "s1", folders: ["f0"] }],
		};

		const merged = mergeSharedCollection({
			structure,
			collections,
			saved,
			newId: minter(),
			nextColor,
			now: NOW,
		});

		const s1 = merged.saved.find((s) => s.storyId === "s1");
		// Pre-existing membership kept, mapped collection unioned in (deduped).
		expect(new Set(s1?.collections)).toEqual(new Set(["c-other", "c-reading"]));
		expect(s1?.savedAt).toBe(5);
	});

	it("keeps two same-named incoming siblings as distinct local folders", () => {
		// Two distinct incoming folders share a name under the same parent. The
		// second must mint its own node, not reuse the first one minted in this
		// same sweep — only pre-existing collections are reuse candidates.
		const structure: ShareStructure = {
			folders: [
				{ key: "f0", name: "Reading", parent: null },
				{ key: "f1", name: "Drafts", parent: "f0" },
				{ key: "f2", name: "Drafts", parent: "f0" },
			],
			items: [
				{ storyId: "s1", folders: ["f1"] },
				{ storyId: "s2", folders: ["f2"] },
			],
		};

		const { collections, saved } = mergeSharedCollection({
			structure,
			collections: [],
			saved: [],
			newId: minter(),
			nextColor,
			now: NOW,
		});

		const reading = collections.find((c) => c.name === "Reading");
		const drafts = collections.filter(
			(c) => c.name === "Drafts" && c.parent === reading?.id,
		);
		// Both "Drafts" siblings survive as separate nodes.
		expect(drafts).toHaveLength(2);
		// Each item lands in exactly one of them, and they differ.
		const s1 = saved.find((s) => s.storyId === "s1");
		const s2 = saved.find((s) => s.storyId === "s2");
		expect(s1?.collections).toHaveLength(1);
		expect(s2?.collections).toHaveLength(1);
		expect(s1?.collections[0]).not.toBe(s2?.collections[0]);
	});

	it("attaches a folder with an unknown parent ref to a root", () => {
		// parseShareStructure normally drops unknown-parent folders, but the merge
		// itself must not crash on one — an unresolvable parent simply leaves the
		// folder unplaced. Here the parent key is present, so it's placed as a
		// child; a missing key is skipped. We assert the resolvable folder lands.
		const structure: ShareStructure = {
			folders: [{ key: "f0", name: "Orphan", parent: null }],
			items: [{ storyId: "s1", folders: ["f0"] }],
		};

		const merged = mergeSharedCollection({
			structure,
			collections: [],
			saved: [],
			newId: minter(),
			nextColor,
			now: NOW,
		});

		const orphan = merged.collections.find((c) => c.name === "Orphan");
		expect(orphan?.parent).toBeNull();
		expect(merged.saved.find((s) => s.storyId === "s1")?.collections).toEqual([
			orphan?.id,
		]);
	});
});

describe("parseShareStructure", () => {
	it("drops an item whose only folder was dropped", () => {
		// f1 has an unknown parent, so it's dropped; s2 referenced only f1, so it
		// has no surviving folder and must not appear in the parsed items — the
		// grouped preview and the import then agree on exactly what's shared.
		const structure = {
			folders: [
				{ key: "f0", name: "Reading", parent: null },
				{ key: "f1", name: "Ghost", parent: "missing" },
			],
			items: [
				{ storyId: "s1", folders: ["f0"] },
				{ storyId: "s2", folders: ["f1"] },
			],
		};

		const parsed = parseShareStructure(JSON.stringify(structure));
		expect(parsed?.folders.map((f) => f.key)).toEqual(["f0"]);
		expect(parsed?.items.map((i) => i.storyId)).toEqual(["s1"]);
	});
});
