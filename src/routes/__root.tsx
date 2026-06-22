import { TanStackDevtools } from "@tanstack/react-devtools";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

import { SiteHeader } from "#/components/site-header";
import appCss from "../styles.css?url";

const favicon =
	"data:image/svg+xml," +
	encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M9 16 L16 30 L23 16 Z" fill="#ff9d52" stroke="#4a3640" stroke-width="1.4" stroke-linejoin="round"/><circle cx="16" cy="11" r="8" fill="#ff93b3" stroke="#4a3640" stroke-width="1.4"/><circle cx="12.7" cy="10.3" r="1.4" fill="#4a3640"/><circle cx="19.3" cy="10.3" r="1.4" fill="#4a3640"/><path d="M12.5 13.2 Q16 16.2 19.5 13.2" stroke="#4a3640" stroke-width="1.7" stroke-linecap="round" fill="none"/></svg>`,
	);

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "Scoop",
			},
			{
				name: "description",
				content: "Scoop is a pretty cool RSS feed reader, powered by Inngest.",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
			{
				rel: "icon",
				href: favicon,
			},
		],
	}),
	shellComponent: RootDocument,
});

// Apply the saved theme before first paint so there's no light-mode flash on a
// dark-mode reload. Runs synchronously in <head>; falls back to the OS setting
// when the visitor hasn't picked one. Mirrors the logic in site-header's toggle.
const themeScript = `(function(){try{var t=localStorage.getItem('scoop-theme');var d=t==='dark'||(t==null&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		// The no-flash script below sets `class="dark"` on <html> before React
		// hydrates, based on localStorage/OS preference the server can't know. That
		// makes the html attributes legitimately differ from the SSR output, so we
		// suppress the (root-level, otherwise unrecoverable) hydration warning here.
		<html lang="en" suppressHydrationWarning>
			<head>
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted static no-flash theme script */}
				<script dangerouslySetInnerHTML={{ __html: themeScript }} />
				<HeadContent />
			</head>
			<body>
				<a
					href="#main-content"
					className="focus-scoop sr-only rounded-lg bg-card px-4 py-2 font-semibold text-foreground no-underline shadow-lg focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50"
				>
					Skip to content
				</a>
				<SiteHeader />
				{children}
				<TanStackDevtools
					config={{
						position: "bottom-right",
					}}
					plugins={[
						{
							name: "Tanstack Router",
							render: <TanStackRouterDevtoolsPanel />,
						},
					]}
				/>
				<Scripts />
			</body>
		</html>
	);
}
