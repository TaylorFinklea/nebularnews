export type Provider = "anthropic" | "openai";

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-5.4-mini",
};
