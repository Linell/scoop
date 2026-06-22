-- The AI layer. Each story gets one shared summary, generated once by the
-- `summarize-story` Inngest job and reused by every visitor. NULL means
-- "not summarized yet" — that's how the job knows what's left to do, and how
-- the next phase will find stories whose summary still needs an LLM-judge score.

ALTER TABLE stories ADD COLUMN summary TEXT;
