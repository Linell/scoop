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
				title: "Scoop — your feeds, scooped",
			},
			{
				name: "description",
				content:
					"Scoop reads your feeds, summarizes the stories, and points you back to the source.",
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

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
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
