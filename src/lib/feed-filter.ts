import { useCallback, useMemo } from "react";
import { createLocalStore } from "./local-store";

/**
 * The feed filter — which flavors the home page is focused on. Multi-select:
 * an empty set means "show every flavor". Like subscriptions, this lives only
 * in localStorage (no auth, no server), so a visitor's focus survives reloads.
 */

const STORAGE_KEY = "scoop.filter.v1";

const store = createLocalStore<string[]>({
	key: STORAGE_KEY,
	fallback: [],
	validate: (parsed) =>
		Array.isArray(parsed)
			? parsed.filter((id): id is string => typeof id === "string")
			: [],
});

export function useFeedFilter() {
	// Start empty so server and first client render agree, then hydrate from
	// localStorage in an effect — same dance as useSubscriptions.
	const { value: ids, setValue: setIds, hydrated } = store.useStore();

	const toggle = useCallback(
		(id: string) => {
			setIds((prev) =>
				prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
			);
		},
		[setIds],
	);

	const clear = useCallback(() => {
		setIds((prev) => (prev.length === 0 ? prev : []));
	}, [setIds]);

	// Drop any ids that aren't in `valid` (e.g. a feed the visitor unsubscribed),
	// so a stale filter can't hide every story. No-op when nothing changes.
	const retain = useCallback(
		(valid: readonly string[]) => {
			setIds((prev) => {
				const keep = new Set(valid);
				const next = prev.filter((id) => keep.has(id));
				return next.length === prev.length ? prev : next;
			});
		},
		[setIds],
	);

	const selected = useMemo(() => new Set(ids), [ids]);

	return { selected, hydrated, toggle, clear, retain };
}
