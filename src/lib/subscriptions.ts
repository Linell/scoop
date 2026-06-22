import { useCallback, useEffect, useState } from "react";

/**
 * A visitor's subscriptions live entirely in localStorage — that's the whole
 * "no auth" story. We store the feed id (which points into the shared D1
 * catalog) plus a flavor color so each feed keeps a stable look for this user.
 */

const STORAGE_KEY = "scoop.subscriptions.v1";

// The ice-cream palette, in the order we hand colors out.
export const FLAVORS = [
	"var(--strawberry)",
	"var(--mint)",
	"var(--blueberry)",
	"var(--lemon)",
	"var(--taro)",
	"var(--mango)",
] as const;

export type Subscription = {
	id: string;
	flavor: string;
};

function read(): Subscription[] {
	if (typeof window === "undefined") return [];
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(s): s is Subscription =>
				s && typeof s.id === "string" && typeof s.flavor === "string",
		);
	} catch {
		return [];
	}
}

function write(subs: Subscription[]) {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(subs));
	} catch {
		// Private mode / quota — nothing actionable, just don't crash.
	}
}

export function useSubscriptions() {
	// Start empty so server and first client render agree, then hydrate from
	// localStorage in an effect. `hydrated` lets the UI hold skeletons until then.
	const [subs, setSubs] = useState<Subscription[]>([]);
	const [hydrated, setHydrated] = useState(false);

	useEffect(() => {
		setSubs(read());
		setHydrated(true);

		// Keep tabs in sync if the user has Scoop open twice.
		const onStorage = (e: StorageEvent) => {
			if (e.key === STORAGE_KEY) setSubs(read());
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, []);

	const subscribe = useCallback((id: string) => {
		setSubs((prev) => {
			if (prev.some((s) => s.id === id)) return prev;
			const flavor = FLAVORS[prev.length % FLAVORS.length];
			const next = [...prev, { id, flavor }];
			write(next);
			return next;
		});
	}, []);

	const unsubscribe = useCallback((id: string) => {
		setSubs((prev) => {
			const next = prev.filter((s) => s.id !== id);
			write(next);
			return next;
		});
	}, []);

	const isSubscribed = useCallback(
		(id: string) => subs.some((s) => s.id === id),
		[subs],
	);

	return {
		subscriptions: subs,
		hydrated,
		subscribe,
		unsubscribe,
		isSubscribed,
	};
}
