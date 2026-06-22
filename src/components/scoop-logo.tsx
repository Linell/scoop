/** A small smiling ice-cream scoop. Kept deliberately simple. */
export function ScoopLogo({ className }: { className?: string }) {
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
				stroke="var(--cocoa)"
				strokeWidth="1.4"
				strokeLinejoin="round"
			/>
			{/* scoop */}
			<circle
				cx="16"
				cy="11"
				r="8"
				fill="var(--strawberry)"
				stroke="var(--cocoa)"
				strokeWidth="1.4"
			/>
			{/* face */}
			<circle cx="12.7" cy="10.3" r="1.4" fill="var(--cocoa)" />
			<circle cx="19.3" cy="10.3" r="1.4" fill="var(--cocoa)" />
			<circle cx="13.2" cy="9.8" r="0.4" fill="var(--whip)" />
			<circle cx="19.8" cy="9.8" r="0.4" fill="var(--whip)" />
			<path
				d="M12.5 13.2 Q16 16.2 19.5 13.2"
				stroke="var(--cocoa)"
				strokeWidth="1.7"
				strokeLinecap="round"
			/>
		</svg>
	);
}
