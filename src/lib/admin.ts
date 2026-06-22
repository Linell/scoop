import { useEffect, useState } from "react";

/**
 * Scoop has no auth (subscriptions live in localStorage), so "admin" is just a
 * client-side flag a developer sets by hand in the console:
 *
 *   localStorage.setItem("scoop.user.v1", JSON.stringify({ admin: true }))
 *
 * It gates dev-only affordances like the per-story "Resummarize" button. It is
 * NOT a security boundary — the underlying resummarize endpoint is open by
 * design (this is a demo); the flag only decides whether the UI offers it.
 */

const STORAGE_KEY = "scoop.user.v1";

function readAdmin(): boolean {
	if (typeof window === "undefined") return false;
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return false;
		const parsed = JSON.parse(raw);
		return parsed?.admin === true;
	} catch {
		return false;
	}
}

/** Whether this visitor has flipped the admin flag. False during SSR/first paint. */
export function useIsAdmin(): boolean {
	// Start false so SSR and the first client render agree, then read in an
	// effect — same hydration dance as useSubscriptions.
	const [admin, setAdmin] = useState(false);

	useEffect(() => {
		setAdmin(readAdmin());
		const onStorage = (e: StorageEvent) => {
			if (e.key === STORAGE_KEY) setAdmin(readAdmin());
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, []);

	return admin;
}
