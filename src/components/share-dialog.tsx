import { Check, Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";

/**
 * The shareable-link dialog, shared by the home page ("share my flavors") and
 * the /saved page (share a collection). Both want the same dance: when the
 * dialog opens, mint a /l/<slug> link, then surface it with copy-to-clipboard.
 * What a link *is* differs (a feeds list vs. a stories list with a folder
 * structure), so the caller supplies `createLink` — an async that publishes the
 * list and returns its absolute url. The dialog owns the busy/error/copied
 * state; the title + description are themeable per call site.
 */
export function ShareDialog({
	open,
	onOpenChange,
	title,
	description,
	createLink,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	createLink: () => Promise<string>;
}) {
	const [url, setUrl] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	// Mint a link when the dialog opens (or re-opens after `createLink` changed).
	// The caller memoizes `createLink` so its reference is stable until the thing
	// being shared actually changes — re-running then is exactly right.
	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setBusy(true);
		setError(null);
		setCopied(false);
		setUrl(null);
		createLink()
			.then((link) => {
				if (!cancelled) setUrl(link);
			})
			.catch(() => {
				if (!cancelled) setError("Couldn't create a share link — try again.");
			})
			.finally(() => {
				if (!cancelled) setBusy(false);
			});
		return () => {
			cancelled = true;
		};
	}, [open, createLink]);

	const onCopy = async () => {
		if (!url) return;
		try {
			await navigator.clipboard.writeText(url);
			setCopied(true);
			setTimeout(() => setCopied(false), 1600);
		} catch {
			// Clipboard may be unavailable (insecure context); fail quietly.
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>

				{error ? (
					<p role="alert" className="text-sm text-strawberry-ink">
						{error}
					</p>
				) : (
					<div className="flex items-center gap-2">
						<input
							readOnly
							value={busy || !url ? "Churning a link…" : url}
							aria-label="Shareable link"
							className="focus-scoop min-w-0 flex-1 truncate rounded-full border border-border bg-card px-4 py-2 text-cocoa-soft text-sm"
							onFocus={(e) => e.currentTarget.select()}
						/>
						<Button
							onClick={onCopy}
							disabled={busy || !url}
							className="shrink-0 rounded-full"
							aria-label={copied ? "Link copied" : "Copy link"}
						>
							{copied ? (
								<Check className="size-4" aria-hidden />
							) : (
								<Link2 className="size-4" aria-hidden />
							)}
							{copied ? "Copied!" : "Copy"}
						</Button>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
