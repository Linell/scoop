import { useEffect, useState } from "react";

/**
 * A durable anonymous visitor id. Where the browse session (see session.ts) is
 * per-tab and dies when the tab closes, this lives in localStorage and persists
 * across visits — the successor to the browse session, the thing that lets the
 * dashboard stitch a returning visitor's clicks and ratings together over time.
 *
 * It's a bearer identifier, not auth: anyone holding the value is treated as
 * that visitor. There's no secret and no verification — it only exists to give
 * the "no auth" story a stable handle.
 */

const STORAGE_KEY = "scoop.client.v1";

/**
 * The visitor's durable client id, minting + persisting one on first use.
 * SSR-safe: with no `window`/`localStorage` it returns an empty string and
 * mints nothing — the id only exists once we're on the client.
 */
export function getClientId(): string {
	if (typeof window === "undefined" || !window.localStorage) return "";
	try {
		let id = window.localStorage.getItem(STORAGE_KEY);
		if (!id) {
			id = crypto.randomUUID();
			window.localStorage.setItem(STORAGE_KEY, id);
		}
		return id;
	} catch {
		// Private mode / quota — degrade to no id rather than crash.
		return "";
	}
}

/**
 * The same id, but reactive: starts empty so server and first client render
 * agree, then hydrates (minting if needed) in an effect — same dance as the
 * other localStorage hooks.
 */
export function useClientId(): string {
	const [id, setId] = useState("");

	useEffect(() => {
		setId(getClientId());
	}, []);

	return id;
}
