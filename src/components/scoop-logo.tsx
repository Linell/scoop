/** A small smiling ice-cream scoop. Kept deliberately simple. */
export function ScoopLogo({ className }: { className?: string }) {
	// Illustration ink stays dark in BOTH themes — it's the outline/face drawn
	// against the bright strawberry/mango fills, not UI text, so it must not
	// flip to near-white the way --cocoa does in dark mode.
	const ink = "#3d2b34";
	const glint = "#fff6ef";
	return (
		<svg
			viewBox="0 0 32 32"
			className={className}
			role="img"
			aria-label="Scoop"
			fill="none"
		>
			{/* cone */}
			<path d="M9 16 L16 30 L23 16 Z" fill="var(--mango)" />
			<path
				d="M9 16 L16 30 L23 16 Z"
				stroke={ink}
				strokeWidth="1.4"
				strokeLinejoin="round"
			/>
			{/* scoop */}
			<circle
				cx="16"
				cy="11"
				r="8"
				fill="var(--strawberry)"
				stroke={ink}
				strokeWidth="1.4"
			/>
			{/* face */}
			<circle cx="12.7" cy="10.3" r="1.4" fill={ink} />
			<circle cx="19.3" cy="10.3" r="1.4" fill={ink} />
			<circle cx="13.2" cy="9.8" r="0.4" fill={glint} />
			<circle cx="19.8" cy="9.8" r="0.4" fill={glint} />
			<path
				d="M12.5 13.2 Q16 16.2 19.5 13.2"
				stroke={ink}
				strokeWidth="1.7"
				strokeLinecap="round"
			/>
		</svg>
	);
}
