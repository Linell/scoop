import { Inngest } from "inngest";

/**
 * The Inngest client. The `id` uniquely identifies this app to Inngest
 * (locally via the Dev Server, and in production via Inngest Cloud).
 */
export const inngest = new Inngest({
	id: "scoop",
});
