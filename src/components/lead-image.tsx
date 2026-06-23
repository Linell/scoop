import { useState } from "react";

/**
 * A story's lead image, hotlinked from the publisher (we never host the bytes).
 * Reserves a 16:9 box so the page doesn't shift as it loads, and quietly removes
 * itself when there's no image or the remote one 404s / a host blocks hotlinking
 * — callers fall back to their image-less layout. Shared by the story detail page
 * and the feed's Photos view so the two stay visually identical.
 */
export function LeadImage({
	src,
	className = "",
}: {
	src: string | null | undefined;
	className?: string;
}) {
	const [failed, setFailed] = useState(false);
	if (!src || failed) return null;
	return (
		<img
			src={src}
			alt=""
			loading="lazy"
			decoding="async"
			referrerPolicy="no-referrer"
			onError={() => setFailed(true)}
			className={`aspect-[16/9] w-full bg-cream-soft object-cover ${className}`}
		/>
	);
}
