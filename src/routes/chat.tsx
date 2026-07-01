import { createFileRoute } from "@tanstack/react-router";
import { ArrowUp, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "#/components/markdown";
import { ScoopLogo } from "#/components/scoop-logo";
import { Button } from "#/components/ui/button";
import { type ChatCitation, storyToCitation } from "#/lib/citation";
import { FLAVORS, type Subscription } from "#/lib/flavor";
import { getBrowseSession } from "#/lib/session";
import type { Feed, Story } from "#/lib/types";
import { storyClickHref } from "#/lib/url";
import { useSession } from "#/lib/use-session";
import { askScoop, type ChatReply } from "#/server/chat";
import { getFeeds, getMySubscriptions, getStories } from "#/server/feeds";

export const Route = createFileRoute("/chat")({ component: Chat });

// Shown only before any stories have loaded (or when a visitor follows nothing).
// Once we have their feeds we build prompts that name real sources instead.
const GENERIC_STARTERS = [
	"What's the biggest story today?",
	"Catch me up in 30 seconds",
	"Anything new worth reading?",
];

const chipClass =
	"focus-scoop rounded-full border border-border bg-card px-3.5 py-2 text-sm text-cocoa-soft no-underline shadow-sm transition-colors hover:border-strawberry hover:text-foreground disabled:opacity-50";

// How many of the freshest stories to surface on the empty landing.
const FRESH_COUNT = 4;

type Message = {
	id: number;
	role: "user" | "assistant";
	content: string;
	citations?: ChatCitation[];
};

type Prompt = { label: string; text: string };

// A chip whose label differs from the text it sends only when we pass one.
const prompt = (text: string, label = text): Prompt => ({ label, text });

const truncate = (s: string, max: number) =>
	s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;

/**
 * Starter chips that prove Scoop already knows the reader's world: one "catch
 * me up" plus one per their most recent feeds, by name. Falls back to generic
 * prompts until their stories load.
 */
function starterPrompts(
	stories: Story[],
	titleOf: (id: string) => string,
): Prompt[] {
	if (stories.length === 0) return GENERIC_STARTERS.map((text) => prompt(text));

	const prompts: Prompt[] = [
		prompt("Catch me up on today's scoops", "Catch me up on today"),
	];
	const seen = new Set<string>();
	for (const story of stories) {
		if (seen.has(story.feedId)) continue;
		seen.add(story.feedId);
		prompts.push(prompt(`What's new in ${titleOf(story.feedId)}?`));
		if (prompts.length >= 4) break;
	}
	return prompts;
}

/** Keep the conversation moving after an answer, anchored on what it cited. */
function followupPrompts(message: Message): Prompt[] {
	const prompts: Prompt[] = [
		prompt("What else is new?"),
		prompt("Show me something different", "Something different"),
	];
	for (const cite of message.citations ?? []) {
		prompts.push(
			prompt(
				`Tell me more about "${cite.title}"`,
				`More on "${truncate(cite.title, 28)}"`,
			),
		);
	}
	return prompts;
}

function Chat() {
	const session = useSession();
	const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
	// Signed-out visitors have no subscriptions to speak of — they get the
	// generic starters + popular-story fallback (askScoop's empty-feedIds path)
	// same as the signed-out home. No `hydrated` gate needed since there's no
	// localStorage read here anymore, just a session-gated fetch below.
	const [subsLoaded, setSubsLoaded] = useState(false);
	const [messages, setMessages] = useState<Message[]>([]);
	const [draft, setDraft] = useState("");
	const [pending, setPending] = useState(false);
	const endRef = useRef<HTMLDivElement>(null);
	const nextId = useRef(0);
	// A stable id for this chat, minted on the first message. Sessions will key
	// on it later (meta.sessions.conversation_id) so a chat turn and the click
	// it drives land in the same Inngest session.
	const conversationId = useRef<string | null>(null);

	const [feeds, setFeeds] = useState<Feed[]>([]);
	const [stories, setStories] = useState<Story[]>([]);

	const feedIds = useMemo(
		() => subscriptions.map((s) => s.id),
		[subscriptions],
	);
	const flavorByFeed = useMemo(
		() => new Map(subscriptions.map((s) => [s.id, s.flavor])),
		[subscriptions],
	);
	const titleOf = useMemo(() => {
		const byId = new Map(feeds.map((f) => [f.id, f.title]));
		return (id: string) => byId.get(id) ?? "a feed";
	}, [feeds]);

	// Pull the signed-in reader's subscriptions once; a signed-out visitor has
	// none, so this just marks `subsLoaded` and leaves feedIds empty.
	useEffect(() => {
		if (!session) {
			setSubsLoaded(true);
			return;
		}
		let cancelled = false;
		getMySubscriptions()
			.then((subs) => {
				if (cancelled) return;
				setSubscriptions(subs.map((s) => ({ id: s.feedId, flavor: s.flavor })));
				setSubsLoaded(true);
			})
			.catch(() => {
				// Treat a failed lookup like "no subscriptions known" so the UI unblocks.
				if (cancelled) return;
				setSubsLoaded(true);
			});
		return () => {
			cancelled = true;
		};
	}, [session]);

	// Load the visitor's feeds + stories once their subscriptions are known, so
	// the page can speak in real headlines and source names rather than generic
	// prompts.
	useEffect(() => {
		if (!subsLoaded) return;
		if (feedIds.length === 0) {
			setFeeds([]);
			setStories([]);
			return;
		}
		let cancelled = false;
		Promise.all([
			getFeeds({ data: feedIds }),
			getStories({ data: feedIds }),
		]).then(
			([f, s]) => {
				if (cancelled) return;
				setFeeds(f);
				setStories(s);
			},
			() => {},
		);
		return () => {
			cancelled = true;
		};
	}, [feedIds, subsLoaded]);

	const starters = useMemo(
		() => starterPrompts(stories, titleOf),
		[stories, titleOf],
	);
	const freshCitations = useMemo(
		() => stories.slice(0, FRESH_COUNT).map((s) => storyToCitation(s, titleOf)),
		[stories, titleOf],
	);

	const lastMessage = messages[messages.length - 1];
	const followups =
		!pending && lastMessage?.role === "assistant"
			? followupPrompts(lastMessage)
			: null;

	// Keep the latest turn in view as the conversation and skeleton change.
	// Honor reduced-motion: JS smooth-scroll bypasses the CSS guards and can be
	// disorienting for vestibular users, so fall back to an instant jump.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-running on each message/pending change is the intent; the body only reads a ref.
	useEffect(() => {
		const reduce =
			typeof window !== "undefined" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		endRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
	}, [messages, pending]);

	const send = async (text: string) => {
		const content = text.trim();
		if (!content || pending) return;

		// Mint the conversation id once, on the first turn (client-only, so no
		// SSR hydration mismatch). Reads via conversationId.current from here on.
		conversationId.current ??= crypto.randomUUID();

		const history: Message[] = [
			...messages,
			{ id: nextId.current++, role: "user", content },
		];
		setMessages(history);
		setDraft("");
		setPending(true);
		try {
			const reply: ChatReply = await askScoop({
				data: {
					turns: history.map(({ role, content }) => ({ role, content })),
					feedIds,
				},
			});
			setMessages((prev) => [
				...prev,
				{
					id: nextId.current++,
					role: "assistant",
					content: reply.reply,
					citations: reply.citations,
				},
			]);
		} catch {
			setMessages((prev) => [
				...prev,
				{
					id: nextId.current++,
					role: "assistant",
					content: "Something went wrong reaching the kitchen. Try that again?",
				},
			]);
		} finally {
			setPending(false);
		}
	};

	const empty = messages.length === 0;

	return (
		<main
			id="main-content"
			className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-3xl flex-col px-4"
		>
			<div className="flex-1 space-y-8 py-10">
				<header className="melt-in">
					<p className="kicker">Ask Scoop</p>
					<h1 className="scoop-title mt-2 text-2xl text-foreground sm:text-3xl">
						What do you want to know?
					</h1>
					<p className="mt-2 max-w-[52ch] text-cocoa-soft">
						Scoop answers from your feeds and links you to the stories worth the
						click.
					</p>

					{empty ? (
						<div className="mt-5">
							<PromptChips
								prompts={starters}
								onPick={send}
								disabled={pending}
							/>
						</div>
					) : null}
				</header>

				{empty && freshCitations.length > 0 ? (
					<section className="melt-in">
						<p className="kicker mb-2">Fresh in your feeds</p>
						<div className="space-y-2.5">
							{freshCitations.map((cite) => (
								<CitedScoop
									key={cite.storyId}
									citation={cite}
									flavorByFeed={flavorByFeed}
								/>
							))}
						</div>
					</section>
				) : null}

				{/* Announce new turns + the thinking indicator to screen readers. */}
				<div className="space-y-8" aria-live="polite" aria-busy={pending}>
					{messages.map((message) =>
						message.role === "user" ? (
							<UserBubble key={message.id} text={message.content} />
						) : (
							<Answer
								key={message.id}
								text={message.content}
								citations={message.citations ?? []}
								flavorByFeed={flavorByFeed}
								cid={conversationId.current ?? undefined}
							/>
						),
					)}

					{pending ? <AnswerSkeleton /> : null}
				</div>

				{followups ? (
					<div className="melt-in pl-12">
						<PromptChips prompts={followups} onPick={send} disabled={pending} />
					</div>
				) : null}

				<div ref={endRef} />
			</div>

			<div className="sticky bottom-0 -mx-4 border-t border-border bg-background/80 px-4 py-4 backdrop-blur-md">
				<div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm focus-within:border-strawberry">
					<textarea
						rows={1}
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								send(draft);
							}
						}}
						disabled={!subsLoaded}
						aria-label="Ask Scoop anything"
						placeholder="Ask Scoop anything…"
						className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2 text-foreground outline-none placeholder:text-cocoa-soft"
					/>
					<Button
						size="icon"
						onClick={() => send(draft)}
						disabled={pending || !draft.trim()}
						aria-label="Send message"
						aria-busy={pending}
						className="size-11 shrink-0 rounded-xl"
					>
						<ArrowUp className="size-4" aria-hidden />
					</Button>
				</div>
				<p className="mt-2 text-center text-xs text-cocoa-soft">
					Scoop gives you the gist — the full scoop always lives at the source.
				</p>
			</div>
		</main>
	);
}

function PromptChips({
	prompts,
	onPick,
	disabled,
}: {
	prompts: Prompt[];
	onPick: (text: string) => void;
	disabled: boolean;
}) {
	return (
		<div className="flex flex-wrap gap-2">
			{prompts.map((chip) => (
				<button
					key={chip.label}
					type="button"
					disabled={disabled}
					onClick={() => onPick(chip.text)}
					className={chipClass}
				>
					{chip.label}
				</button>
			))}
		</div>
	);
}

function UserBubble({ text }: { text: string }) {
	return (
		<div className="melt-in flex justify-end">
			<p className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-secondary px-4 py-2.5 text-secondary-foreground">
				{text}
			</p>
		</div>
	);
}

function Answer({
	text,
	citations,
	flavorByFeed,
	cid,
}: {
	text: string;
	citations: ChatCitation[];
	flavorByFeed: Map<string, string>;
	cid?: string;
}) {
	return (
		<div className="melt-in flex gap-3">
			<div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-card">
				<ScoopLogo className="h-7 w-7" />
			</div>
			<div className="min-w-0 flex-1 space-y-4 pt-1">
				<Markdown>{text}</Markdown>

				{citations.length > 0 ? (
					<div>
						<p className="kicker mb-2">Worth a click</p>
						<div className="space-y-2.5">
							{citations.map((cite) => (
								<CitedScoop
									key={cite.storyId}
									citation={cite}
									flavorByFeed={flavorByFeed}
									cid={cid}
								/>
							))}
						</div>
					</div>
				) : null}
			</div>
		</div>
	);
}

function CitedScoop({
	citation,
	flavorByFeed,
	cid,
}: {
	citation: ChatCitation;
	flavorByFeed: Map<string, string>;
	cid?: string;
}) {
	const flavor = flavorByFeed.get(citation.feedId) ?? FLAVORS[0];
	return (
		<a
			href={storyClickHref(citation.storyId, "chat", {
				cid,
				bs: getBrowseSession(),
			})}
			target="_blank"
			rel="noreferrer"
			className="whip-card whip-card-hover focus-scoop group flex w-full items-center gap-3 p-3 text-left no-underline"
		>
			<span
				className="flavor-dot shrink-0"
				style={{ "--flavor": flavor } as React.CSSProperties}
			/>
			<div className="min-w-0 flex-1">
				<p className="truncate font-semibold text-foreground text-sm">
					{citation.title}
				</p>
				<p className="truncate text-cocoa-soft text-xs">{citation.feedTitle}</p>
			</div>
			<ExternalLink
				className="size-4 shrink-0 text-strawberry-ink transition-transform group-hover:translate-x-0.5"
				aria-hidden
			/>
		</a>
	);
}

function AnswerSkeleton() {
	return (
		<div className="melt-in flex gap-3">
			<div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-card">
				<ScoopLogo className="h-7 w-7" />
			</div>
			<div className="flex min-w-0 flex-1 items-center pt-1">
				<span className="scoop-thinking" aria-hidden="true">
					<i />
					<i />
					<i />
				</span>
				<output className="sr-only">Scoop is thinking…</output>
			</div>
		</div>
	);
}
