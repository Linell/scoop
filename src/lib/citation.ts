import type { Story } from "#/lib/types";

/** A story the chat points at, shaped for a clickable card on the client. */
export type ChatCitation = {
	storyId: string;
	feedId: string;
	title: string;
	feedTitle: string;
};

/** Project a story into a citation, resolving its feed's display title. */
export const storyToCitation = (
	story: Story,
	feedTitle: (id: string) => string,
): ChatCitation => ({
	storyId: story.id,
	feedId: story.feedId,
	title: story.title,
	feedTitle: feedTitle(story.feedId),
});
