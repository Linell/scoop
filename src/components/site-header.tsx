import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { ScoopLogo } from "#/components/scoop-logo";
import { SprinkleShower } from "#/components/sprinkle-shower";
import { ThemeToggle } from "#/components/theme-toggle";
import { Button } from "#/components/ui/button";

const navLink =
	"rounded-full px-3 py-1.5 text-cocoa-soft no-underline transition-colors hover:bg-secondary hover:text-foreground [&.active]:bg-secondary [&.active]:text-foreground";

export function SiteHeader() {
	// Triple-click the logo for a sprinkle shower. We count clicks within a short
	// window without swallowing the logo's normal navigation to home.
	const clicks = useRef(0);
	const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [sprinkling, setSprinkling] = useState(false);

	const onLogoClick = () => {
		clicks.current += 1;
		if (resetTimer.current) clearTimeout(resetTimer.current);
		if (clicks.current >= 3) {
			clicks.current = 0;
			const reduce = window.matchMedia(
				"(prefers-reduced-motion: reduce)",
			).matches;
			if (!reduce) setSprinkling(true);
			return;
		}
		resetTimer.current = setTimeout(() => {
			clicks.current = 0;
		}, 600);
	};

	return (
		<header className="sticky top-0 z-40 border-b border-border bg-background/70 backdrop-blur-md">
			<div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:gap-6">
				<Link
					to="/"
					onClick={onLogoClick}
					className="scoop-logo-link flex shrink-0 items-center gap-2 no-underline"
				>
					<ScoopLogo className="h-8 w-8" />
					<span className="scoop-title text-xl text-foreground">scoop</span>
				</Link>

				{/* Quiet secondary links. Feed is reachable via the logo too, so we
				    drop the redundant Feed tab on mobile to keep the bar uncluttered. */}
				<nav className="ml-1 flex items-center gap-1 text-sm">
					<Link
						to="/"
						className={`hidden sm:inline-flex ${navLink}`}
						activeOptions={{ exact: true }}
					>
						Feed
					</Link>
					<Link to="/saved" className={navLink}>
						Saved
					</Link>
					<Link to="/about" className={navLink}>
						About
					</Link>
				</nav>

				{/* Flagship action gets the prime right-hand slot as a filled CTA. */}
				<div className="ml-auto flex items-center gap-1.5 sm:gap-2">
					<ThemeToggle />
					<Button asChild size="sm" className="rounded-full">
						<Link to="/chat" className="no-underline" aria-label="Ask Scoop">
							<Sparkles className="size-4" aria-hidden />
							<span className="hidden sm:inline">Ask Scoop</span>
						</Link>
					</Button>
				</div>
			</div>

			{sprinkling ? (
				<SprinkleShower onDone={() => setSprinkling(false)} />
			) : null}
		</header>
	);
}
