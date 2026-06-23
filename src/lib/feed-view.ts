import { useCallback, useEffect } from "react";
import { createLocalStore } from "./local-store";

/**
 * The feed view mode — how the home page renders story cards. "text" is the
 * default, clean, text-only layout; "photos" adds each story's lead image where
 * one exists. Set once (from the About page) and remembered, like subscriptions
 * and the flavor filter, this lives only in localStorage — no auth, no server.
 */

export type FeedView = "text" | "photos";

const STORAGE_KEY = "scoop.view.v1";

const store = createLocalStore<FeedView>({
	key: STORAGE_KEY,
	fallback: "text",
	validate: (parsed) => (parsed === "photos" ? "photos" : "text"),
});

/**
 * One-time legacy migration. The view used to be stored as a RAW string
 * (localStorage.setItem(key, "photos")), but createLocalStore reads via
 * JSON.parse — so a legacy bare value throws and silently falls back to "text",
 * losing the preference. If we find an unquoted "photos"/"text", rewrite it as
 * JSON so the store can read it. SSR-safe and crash-safe (private mode).
 */
function migrateLegacyView() {
	if (typeof window === "undefined") return;
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (raw === "photos" || raw === "text") {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
		}
	} catch {
		// Private mode / quota — nothing actionable, just don't crash.
	}
}

export function useFeedView() {
	// Rewrite any legacy bare value before the store reads it (and re-reads on a
	// cross-tab storage event). Runs once on the client, before hydration below.
	useEffect(() => {
		migrateLegacyView();
	}, []);

	// Start on the default so server and first client render agree, then hydrate
	// from localStorage in an effect — same dance as useSubscriptions/useFeedFilter.
	const { value: view, setValue, hydrated } = store.useStore();

	const setView = useCallback(
		(next: FeedView) => {
			setValue(next);
		},
		[setValue],
	);

	return { view, hydrated, setView };
}
