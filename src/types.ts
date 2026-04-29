export type QuizMode = "manual" | "llm";

export interface QuizSnapshot {
  question: string;
  options: string[];
  isMultiSelect: boolean;
  hasTextResponse: boolean;
}

export interface OpenRouterConfig {
  apiKey?: string;
  model: string;
  siteUrl?: string;
  appName?: string;
  temperature: number;
  timeoutMs: number;
}

export interface QuizAnswer {
  answerIndices: number[];
  textAnswer?: string;
  confidence?: number;
  explanation?: string;
}
