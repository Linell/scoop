import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
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

				{/* Feed is reachable via the logo; on mobile we keep the flagship
				    "Ask Scoop" link visible and drop the redundant Feed tab. */}
				<nav className="ml-1 flex items-center gap-1 text-sm">
					<Link
						to="/"
						className={`hidden sm:inline-flex ${navLink}`}
						activeOptions={{ exact: true }}
					>
						Feed
					</Link>
					<Link to="/chat" className={navLink}>
						Ask Scoop
					</Link>
				</nav>

				<div className="ml-auto">
					{/* Full label on desktop, icon-only on mobile so it never clips */}
					<Button size="sm" className="rounded-full max-sm:size-9 max-sm:p-0">
						<Plus className="size-4" />
						<span className="max-sm:sr-only">Add a flavor</span>
					</Button>
				</div>
			</div>
		</header>
	);
}
