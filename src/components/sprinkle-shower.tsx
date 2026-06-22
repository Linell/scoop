import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const SPRINKLE_FLAVORS = [
	"var(--strawberry)",
	"var(--mint)",
	"var(--blueberry)",
	"var(--lemon)",
	"var(--mango)",
	"var(--taro)",
];

/**
 * A one-off rain of flavored sprinkles — the payoff for triple-clicking the
 * logo (the About page promises "extra sprinkles 🍦"). Purely decorative and
 * aria-hidden; the caller gates it on prefers-reduced-motion and unmounts it via
 * onDone once the fall finishes. We portal the overlay to document.body so its
 * position: fixed is relative to the viewport — the header's backdrop-blur would
 * otherwise establish a containing block and clip the rain to the header band.
 */
export function SprinkleShower({ onDone }: { onDone: () => void }) {
	const [sprinkles] = useState(() =>
		Array.from({ length: 90 }, (_, i) => ({
			id: i,
			left: Math.random() * 100,
			delay: Math.random() * 0.6,
			dur: 1.8 + Math.random() * 1.5,
			spin: (Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 540),
			color: SPRINKLE_FLAVORS[i % SPRINKLE_FLAVORS.length],
		})),
	);

	useEffect(() => {
		const t = setTimeout(onDone, 3600);
		return () => clearTimeout(t);
	}, [onDone]);

	// document is undefined during SSR; this only ever mounts after a client
	// click, but guard anyway so we never reach createPortal on the server.
	if (typeof document === "undefined") return null;

	return createPortal(
		<div className="sprinkle-shower" aria-hidden="true">
			{sprinkles.map((s) => (
				<span
					key={s.id}
					className="sprinkle"
					style={
						{
							left: `${s.left}%`,
							background: s.color,
							"--delay": `${s.delay}s`,
							"--dur": `${s.dur}s`,
							"--spin": `${s.spin}deg`,
						} as React.CSSProperties
					}
				/>
			))}
		</div>,
		document.body,
	);
}
