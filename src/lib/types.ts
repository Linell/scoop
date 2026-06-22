/** Shapes shared between the server functions and the client. */

export type Feed = {
	id: string;
	feedUrl: string;
	title: string;
	siteUrl: string | null;
	description: string | null;
	fetchedAt: number;
};

export type Story = {
	id: string;
	feedId: string;
	url: string;
	title: string;
	author: string | null;
	content: string | null;
	publishedAt: number;
	summary: string | null; // AI summary; null until the summarize job fills it in
};
