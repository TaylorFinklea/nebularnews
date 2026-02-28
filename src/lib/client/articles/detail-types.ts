export type ArticleUtilitySectionId = 'tags' | 'ai_tools' | 'chat' | 'feedback' | 'sources';

export type ArticleUtilityLayout = 'inspector' | 'sheet';

export type ArticleLeadTagChip = {
  id: string;
  name: string;
};

export type ArticleUtilitySummary = {
  tagsCount: number;
  suggestionCount: number;
  sourceCount: number;
  feedbackCount: number;
  chatReady: boolean;
};
