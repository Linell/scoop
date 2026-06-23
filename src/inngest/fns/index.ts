import { judgeSummaryScorer } from "./judge-summary";
import { refreshFeed } from "./refresh-feed";
import { refreshFeeds } from "./refresh-feeds";
import { resummarizeStory } from "./resummarize-story";
import { scoreClick } from "./score-click";
import { scoreRating } from "./score-rating";
import { scoreSave } from "./score-save";
import { summarizeStory } from "./summarize-story";

/**
 * The list of all Inngest functions served by this app. Add new functions
 * here so they get registered with Inngest when the app syncs.
 */
export const functions = [
	refreshFeeds,
	refreshFeed,
	summarizeStory,
	resummarizeStory,
	judgeSummaryScorer,
	scoreClick,
	scoreRating,
	scoreSave,
];
