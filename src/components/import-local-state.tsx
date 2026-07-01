import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { useSession } from "#/lib/use-session";

/**
 * One-time merge of a browser's pre-login localStorage state into a freshly
 * signed-in reader's server-side rows — the actual fix for "my flavors don't
 * follow me from desktop to phone." Mounted once from __root.tsx's shell so it
 * runs on every page; client-only (reads localStorage), so it must never touch
 * SSR output — the component always renders null on the server and only does
 * anything once mounted.
 */

const IMPORTED_KEY = "scoop.imported.v1";
// Last reader of these legacy keys: the localStorage-backed subscriptions/saved
// hooks that used to own them are gone (accounts replaced them), but a returning
// visitor's browser may still be holding data under them.
const LEGACY_SUBSCRIPTIONS_KEY = "scoop.subscriptions.v1";
const LEGACY_SAVED_KEY = "scoop.saved.v1";

type ImportedFlag = { userId: string; importedAt: number };

type LegacySubscription = { id: string; flavor: string };
type LegacySavedStory = {
	storyId: string;
	savedAt: number;
	collections: string[];
};

function readImportedFlag(): ImportedFlag | null {
	try {
		const raw = window.localStorage.getItem(IMPORTED_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		return typeof parsed?.userId === "string" &&
			typeof parsed?.importedAt === "number"
			? parsed
			: null;
	} catch {
		return null;
	}
}

function readLegacySubscriptions(): LegacySubscription[] {
	try {
		const raw = window.localStorage.getItem(LEGACY_SUBSCRIPTIONS_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter(
					(s): s is LegacySubscription =>
						s && typeof s.id === "string" && typeof s.flavor === "string",
				)
			: [];
	} catch {
		return [];
	}
}

function readLegacySaved(): LegacySavedStory[] {
	try {
		const raw = window.localStorage.getItem(LEGACY_SAVED_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter(
					(s): s is LegacySavedStory =>
						s &&
						typeof s.storyId === "string" &&
						typeof s.savedAt === "number" &&
						Array.isArray(s.collections),
				)
			: [];
	} catch {
		return [];
	}
}

export function ImportLocalState() {
	const session = useSession();
	const [result, setResult] = useState<{
		subscriptions: number;
		saved: number;
	} | null>(null);

	useEffect(() => {
		if (!session) return;

		const flag = readImportedFlag();
		if (flag && flag.userId === session.id) return; // already imported here

		const subscriptions = readLegacySubscriptions();
		const saved = readLegacySaved();

		if (subscriptions.length === 0 && saved.length === 0) {
			window.localStorage.setItem(
				IMPORTED_KEY,
				JSON.stringify({ userId: session.id, importedAt: Date.now() }),
			);
			return;
		}

		let cancelled = false;
		import("#/server/feeds").then(
			async (m) => {
				try {
					await m.importLocalState({ data: { subscriptions, saved } });
				} catch {
					return; // no flag write — retries harmlessly on next page load
				}
				if (cancelled) return;
				window.localStorage.setItem(
					IMPORTED_KEY,
					JSON.stringify({ userId: session.id, importedAt: Date.now() }),
				);
				window.localStorage.removeItem(LEGACY_SUBSCRIPTIONS_KEY);
				window.localStorage.removeItem(LEGACY_SAVED_KEY);
				setResult({
					subscriptions: subscriptions.length,
					saved: saved.length,
				});
			},
			() => {},
		);
		return () => {
			cancelled = true;
		};
	}, [session]);

	if (!result) return null;

	const parts = [
		result.subscriptions > 0
			? `${result.subscriptions} flavor${result.subscriptions === 1 ? "" : "s"}`
			: null,
		result.saved > 0
			? `${result.saved} saved ${result.saved === 1 ? "story" : "stories"}`
			: null,
	].filter((p): p is string => p != null);

	return (
		<div
			aria-live="polite"
			className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
		>
			<div className="melt-in pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2.5 text-sm text-foreground shadow-lg">
				<Check className="size-4 shrink-0 text-strawberry-ink" aria-hidden />
				<span className="truncate">
					Imported {parts.join(" and ")} from this device
				</span>
				<button
					type="button"
					onClick={() => setResult(null)}
					className="focus-scoop shrink-0 rounded-full px-2 py-0.5 font-semibold text-strawberry-ink hover:underline"
				>
					Dismiss
				</button>
			</div>
		</div>
	);
}
