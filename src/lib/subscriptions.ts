import { useCallback } from "react";
import { createLocalStore } from "./local-store";

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

const store = createLocalStore<Subscription[]>({
	key: STORAGE_KEY,
	fallback: [],
	validate: (parsed) =>
		Array.isArray(parsed)
			? parsed.filter(
					(s): s is Subscription =>
						s && typeof s.id === "string" && typeof s.flavor === "string",
				)
			: [],
});

export function useSubscriptions() {
	// Start empty so server and first client render agree, then hydrate from
	// localStorage in an effect. `hydrated` lets the UI hold skeletons until then.
	const { value: subs, setValue: setSubs, hydrated } = store.useStore();

	const subscribe = useCallback(
		(id: string) => {
			setSubs((prev) => {
				if (prev.some((s) => s.id === id)) return prev;
				const flavor = FLAVORS[prev.length % FLAVORS.length];
				return [...prev, { id, flavor }];
			});
		},
		[setSubs],
	);

	// Remove a feed and hand back what was removed (the object + where it sat),
	// so the caller can offer a one-tap undo without re-deriving that itself.
	// Returns null when the id wasn't subscribed.
	const unsubscribe = useCallback(
		(id: string): { sub: Subscription; index: number } | null => {
			const index = subs.findIndex((s) => s.id === id);
			if (index === -1) return null;
			const sub = subs[index];
			setSubs((prev) => prev.filter((s) => s.id !== id));
			return { sub, index };
		},
		[subs, setSubs],
	);

	// Put an exact subscription back at its original spot — the undo half of an
	// unfollow. Restoring the original object (not re-running subscribe) keeps
	// the feed's flavor color and sidebar position stable, so an undo looks like
	// the unfollow simply never happened. Guarded so a double-undo is a no-op.
	const restore = useCallback(
		(sub: Subscription, index: number) => {
			setSubs((prev) => {
				if (prev.some((s) => s.id === sub.id)) return prev;
				const next = [...prev];
				next.splice(Math.min(index, next.length), 0, sub);
				return next;
			});
		},
		[setSubs],
	);

	const isSubscribed = useCallback(
		(id: string) => subs.some((s) => s.id === id),
		[subs],
	);

	// Forget every flavor — the whole point of the About page's reset button.
	const clear = useCallback(() => {
		setSubs([]);
	}, [setSubs]);

	return {
		subscriptions: subs,
		hydrated,
		subscribe,
		unsubscribe,
		restore,
		isSubscribed,
		clear,
	};
}
