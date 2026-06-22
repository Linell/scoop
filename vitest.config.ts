import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Vitest runs against the plain module graph, not the Worker bundle, so we
 * deliberately skip the app's vite.config.ts — its Cloudflare plugin sets
 * `resolve.external`, which the plugin itself rejects outside a real Worker
 * build. We only need the `#/*` path alias to mirror tsconfig.
 */
export default defineConfig({
	resolve: {
		alias: { "#": resolve(import.meta.dirname, "src") },
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.{ts,tsx}"],
	},
});
