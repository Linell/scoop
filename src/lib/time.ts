/** Time helpers shared across the UI. */

/** A compact "3h ago" / "2d ago" stamp from an epoch-ms timestamp. */
export function relativeTime(ms: number | null): string {
	// No usable publish date — don't fake a freshness we don't have.
	if (ms == null) return "recently added";
	const s = Math.round((Date.now() - ms) / 1000);
	if (s < 60) return "just now";
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.round(h / 24);
	if (d < 7) return `${d}d ago`;
	return `${Math.round(d / 7)}w ago`;
}
