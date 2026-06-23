import { useCallback, useEffect, useState } from "react";

/**
 * The feed view mode — how the home page renders story cards. "text" is the
 * default, clean, text-only layout; "photos" adds each story's lead image where
 * one exists. Set once (from the About page) and remembered, like subscriptions
 * and the flavor filter, this lives only in localStorage — no auth, no server.
 */

export type FeedView = "text" | "photos";

const STORAGE_KEY = "scoop.view.v1";

function read(): FeedView {
	if (typeof window === "undefined") return "text";
	try {
		return window.localStorage.getItem(STORAGE_KEY) === "photos"
			? "photos"
			: "text";
	} catch {
		return "text";
	}
}

function write(view: FeedView) {
	try {
		window.localStorage.setItem(STORAGE_KEY, view);
	} catch {
		// Private mode / quota — nothing actionable, just don't crash.
	}
}

export function useFeedView() {
	// Start on the default so server and first client render agree, then hydrate
	// from localStorage in an effect — same dance as useSubscriptions/useFeedFilter.
	const [view, setViewState] = useState<FeedView>("text");
	const [hydrated, setHydrated] = useState(false);

	useEffect(() => {
		setViewState(read());
		setHydrated(true);

		// Keep tabs in sync if the user has Scoop open twice.
		const onStorage = (e: StorageEvent) => {
			if (e.key === STORAGE_KEY) setViewState(read());
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, []);

	const setView = useCallback((next: FeedView) => {
		setViewState(next);
		write(next);
	}, []);

	return { view, hydrated, setView };
}
