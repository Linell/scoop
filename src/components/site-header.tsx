import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { ScoopLogo } from "#/components/scoop-logo";
import { Button } from "#/components/ui/button";

const navLink =
	"rounded-full px-3 py-1.5 text-cocoa-soft no-underline transition-colors hover:bg-secondary hover:text-foreground [&.active]:bg-secondary [&.active]:text-foreground";

export function SiteHeader() {
	return (
		<header className="sticky top-0 z-40 border-b border-border bg-background/70 backdrop-blur-md">
			<div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:gap-6">
				<Link to="/" className="flex shrink-0 items-center gap-2 no-underline">
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
					<Link to="/about" className={navLink}>
						About
					</Link>
				</nav>

				{/* Flagship action gets the prime right-hand slot as a filled CTA. */}
				<div className="ml-auto">
					<Button asChild size="sm" className="rounded-full">
						<Link to="/chat" className="no-underline">
							<Sparkles className="size-4" />
							Ask Scoop
						</Link>
					</Button>
				</div>
			</div>
		</header>
	);
}
