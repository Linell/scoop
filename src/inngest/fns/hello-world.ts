import { inngest } from "../client";

/**
 * A minimal Inngest function. It's triggered by the `test/hello.world` event,
 * sleeps for a second (a durable step), then returns a greeting.
 *
 * Send the trigger event from anywhere with:
 *   await inngest.send({ name: "test/hello.world", data: { email: "you@example.com" } })
 */
export const helloWorld = inngest.createFunction(
	{
		id: "hello-world",
		triggers: [{ event: "test/hello.world" }],
	},
	async ({ event, step }) => {
		await step.sleep("wait-a-moment", "1s");

		const email = event.data?.email ?? "World";
		return { message: `Hello ${email}!` };
	},
);
