import ReactMarkdown, { type Components } from "react-markdown";

// Allocated once: a stable map keeps react-markdown from re-deriving renderers
// on every Answer render. Links open safely in a new tab.
const COMPONENTS: Components = {
	a: ({ node: _node, ...props }) => (
		<a target="_blank" rel="noreferrer" {...props} />
	),
};

/**
 * Renders an assistant reply's markdown (bold, emphasis, lists, the odd link)
 * at our type scale. Tailwind's `prose` does the layout; we just retint it to
 * the ice-cream palette and open any link safely in a new tab.
 */
export function Markdown({ children }: { children: string }) {
	return (
		<div className="prose prose-sm max-w-[60ch] leading-relaxed [--tw-prose-body:var(--color-foreground)] [--tw-prose-bold:var(--color-foreground)] [--tw-prose-bullets:var(--color-cocoa-soft)] [--tw-prose-counters:var(--color-cocoa-soft)] [--tw-prose-headings:var(--color-foreground)] [--tw-prose-links:var(--color-strawberry-ink)]">
			<ReactMarkdown components={COMPONENTS}>{children}</ReactMarkdown>
		</div>
	);
}
