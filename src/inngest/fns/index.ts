import { helloWorld } from "./hello-world";
import { refreshFeeds } from "./refresh-feeds";
import { resummarizeStory } from "./resummarize-story";
import { summarizeStory } from "./summarize-story";

/**
 * The list of all Inngest functions served by this app. Add new functions
 * here so they get registered with Inngest when the app syncs.
 */
export const functions = [
	helloWorld,
	refreshFeeds,
	summarizeStory,
	resummarizeStory,
];
