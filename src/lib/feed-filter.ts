import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * The feed filter — which flavors the home page is focused on. Multi-select:
 * an empty set means "show every flavor". Like subscriptions, this lives only
 * in localStorage (no auth, no server), so a visitor's focus survives reloads.
 */

const STORAGE_KEY = "scoop.filter.v1";

function read(): string[] {
	if (typeof window === "undefined") return [];
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((id): id is string => typeof id === "string");
	} catch {
		return [];
	}
}

function write(ids: string[]) {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
	} catch {
		// Private mode / quota — nothing actionable, just don't crash.
	}
}

export function useFeedFilter() {
	// Start empty so server and first client render agree, then hydrate from
	// localStorage in an effect — same dance as useSubscriptions.
	const [ids, setIds] = useState<string[]>([]);
	const [hydrated, setHydrated] = useState(false);

	useEffect(() => {
		setIds(read());
		setHydrated(true);

		// Keep tabs in sync if the user has Scoop open twice.
		const onStorage = (e: StorageEvent) => {
			if (e.key === STORAGE_KEY) setIds(read());
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, []);

	const toggle = useCallback((id: string) => {
		setIds((prev) => {
			const next = prev.includes(id)
				? prev.filter((x) => x !== id)
				: [...prev, id];
			write(next);
			return next;
		});
	}, []);

	const clear = useCallback(() => {
		setIds((prev) => {
			if (prev.length === 0) return prev;
			write([]);
			return [];
		});
	}, []);

	// Drop any ids that aren't in `valid` (e.g. a feed the visitor unsubscribed),
	// so a stale filter can't hide every story. No-op when nothing changes.
	const retain = useCallback((valid: readonly string[]) => {
		setIds((prev) => {
			const keep = new Set(valid);
			const next = prev.filter((id) => keep.has(id));
			if (next.length === prev.length) return prev;
			write(next);
			return next;
		});
	}, []);

	const selected = useMemo(() => new Set(ids), [ids]);

	return { selected, hydrated, toggle, clear, retain };
}
