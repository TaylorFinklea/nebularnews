export type ArticleUtilitySectionId = 'tags' | 'ai_tools' | 'chat' | 'feedback' | 'sources';
export type ArticleUtilityLayout = 'inspector' | 'sheet';

export type ArticleBlock =
	| { type: 'heading'; text: string }
	| { type: 'list'; items: string[] }
	| { type: 'paragraph'; text: string }
	| { type: 'paragraph_group'; paragraphs: string[] };
