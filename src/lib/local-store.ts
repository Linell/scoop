import { useCallback, useEffect, useState } from "react";

/**
 * The whole "no auth" story is a pile of little localStorage values — subscriptions,
 * the flavor filter, the view mode — each repeating the same SSR-safe dance: start
 * on a default so server and first client render agree, hydrate in an effect (with a
 * `hydrated` flag so the UI can hold skeletons), listen for cross-tab `storage`
 * events, and write through a try/catch that never crashes in private mode. This
 * factory bottles that dance up once; each module just supplies a key, a fallback,
 * and a `validate` that sanitizes whatever JSON.parse coughs up.
 */

type Updater<T> = T | ((prev: T) => T);

export function createLocalStore<T>({
	key,
	fallback,
	validate,
}: {
	key: string;
	fallback: T;
	validate: (parsed: unknown) => T;
}) {
	// SSR-safe read: no window → fallback; parse + sanitize, swallowing anything
	// that throws (bad JSON, private mode) back to the fallback.
	function read(): T {
		if (typeof window === "undefined") return fallback;
		try {
			const raw = window.localStorage.getItem(key);
			if (!raw) return fallback;
			return validate(JSON.parse(raw));
		} catch {
			return fallback;
		}
	}

	function write(value: T) {
		try {
			window.localStorage.setItem(key, JSON.stringify(value));
		} catch {
			// Private mode / quota — nothing actionable, just don't crash.
		}
	}

	function useStore() {
		// Start on the fallback so server and first client render agree, then
		// hydrate from localStorage in an effect. `hydrated` lets the UI hold
		// skeletons until then.
		const [value, setState] = useState<T>(fallback);
		const [hydrated, setHydrated] = useState(false);

		useEffect(() => {
			setState(read());
			setHydrated(true);

			// Keep tabs in sync if the user has Scoop open twice.
			const onStorage = (e: StorageEvent) => {
				if (e.key === key) setState(read());
			};
			window.addEventListener("storage", onStorage);
			return () => window.removeEventListener("storage", onStorage);
			// `key`/`read`/`write` are stable for the store's lifetime, so run once.
		}, []);

		const setValue = useCallback((next: Updater<T>) => {
			setState((prev) => {
				const resolved =
					typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
				write(resolved);
				return resolved;
			});
		}, []);

		return { value, setValue, hydrated };
	}

	return { read, write, useStore };
}
