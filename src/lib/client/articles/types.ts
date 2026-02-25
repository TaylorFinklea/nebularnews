export type ArticleTag = {
  id: string;
  name: string;
};

export type ArticleTagSuggestion = {
  id: string;
  article_id: string;
  name: string;
  name_normalized: string;
  confidence: number | null;
  source_provider?: string | null;
  source_model?: string | null;
  created_at?: number;
  updated_at?: number;
};

export type ArticleListItem = {
  id: string;
  canonical_url?: string | null;
  image_url?: string | null;
  title?: string | null;
  author?: string | null;
  published_at?: string | null;
  fetched_at?: string | null;
  excerpt?: string | null;
  summary_text?: string | null;
  is_read?: number | boolean | null;
  reaction_value?: number | null;
  score?: number | null;
  score_label?: string | null;
  source_name?: string | null;
  source_feed_id?: string | null;
  source_reputation?: number;
  source_feedback_count?: number;
  tags?: ArticleTag[];
  tag_suggestions?: ArticleTagSuggestion[];
};

export type AvailableTag = {
  id: string;
  name: string;
  article_count: number;
};

export type ArticlesPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
  start: number;
  end: number;
};

export type ArticlesFilters = {
  selectedScores: string[];
  selectedReactions: string[];
  selectedTagIds: string[];
  readFilter: 'all' | 'read' | 'unread';
};

export type ArticlesUiState = {
  serverArticles: ArticleListItem[];
  optimisticById: Record<string, Partial<ArticleListItem>>;
  pendingById: Record<string, true>;
  imageErrors: Record<string, true>;
  uiMessage: string;
};
