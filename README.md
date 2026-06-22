# Scoop

Scoop is a demo for Inngest's scoring capabilities, dressed up as an ice-cream-themed RSS reader with an "Ask Scoop" chatbot.

The reader is the vehicle; scoring is the point. Two scores show up across the app:

1. **LLM-as-judge** grades how well the pipeline summarized each story (a good "scoop" is a teaser that earns a click, not a replacement for the article).
2. **Deferred conversion score** ties a chat answer to whether the reader actually clicked through to a story it cited, using one Inngest session per conversation so the later click matches back.

Vocabulary: feeds are **flavors**, summaries are **scoops**, the chatbot is **Ask Scoop**, cited links are **worth a click**.

## Stack

TanStack Start + React 19 on Cloudflare Workers, Inngest for the durable ingest/summarize/score pipeline, D1 for the shared story catalog (`localStorage` holds a user's subscribed flavors, no auth), Tailwind v4 + shadcn/ui, Biome, Vitest, and Claude for summaries, the judge, and chat.

## Architecture

- `src/routes` - file-based routes: `/` (feed), `/chat`, `/story/$storyId`, `/about`, `/r/$storyId` (click tracker that fires `scoop/story.clicked` before redirecting), `/api/inngest`
- `src/inngest` - client, events, and functions: `refresh-feeds` (cron), `refresh-feed`, `summarize-story`, `resummarize-story`
- `src/server` - D1 access, feed queries, RSS parsing, article extraction, summarization, chat
- `src/lib` - shared helpers (parsing, URL hashing, subscriptions hook); `migrations` - D1 schema

Stories are deduped by a hash of their normalized URL, and each new story fans out its own `summarize-story` run. Summarization is the seam where the LLM-as-judge score attaches next.

## Local development

Copy `.dev.vars.example` to `.dev.vars` and fill in your keys, then:

```bash
npm install
npx wrangler d1 migrations apply scoop --local
npm run dev                 # app on http://localhost:3000
npx inngest-cli@latest dev  # Inngest Dev Server, auto-discovers /api/inngest
```

Other scripts: `npm run build`, `npm run test`, `npm run check` (Biome), `npm run deploy`.

## Deploy

Runs as the Cloudflare Worker `scoop`, push-to-deploy via Workers Builds on `main`.

- Apply schema changes to prod: `npx wrangler d1 migrations apply scoop --remote` (Workers Builds does not run migrations automatically)
- Set secrets with `wrangler secret put`: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `INNGEST_SIGNING_KEY` + `INNGEST_EVENT_KEY` from Inngest Cloud's production environment. Do not set `INNGEST_DEV` in production.
