export type QuizMode = "manual" | "llm";

export interface QuizSnapshot {
  question: string;
  options: string[];
  isMultiSelect: boolean;
  hasTextResponse: boolean;
}

export type LlmProvider = "openrouter" | "ollama" | "lmstudio";

export type LlmStructuredOutputMode = "json_schema" | "json_object";

export interface LlmConfig {
  provider: LlmProvider;
  apiKey?: string;
  model: string;
  baseUrl: string;
  siteUrl?: string;
  appName?: string;
  temperature: number;
  timeoutMs: number;
  structuredOutputMode: LlmStructuredOutputMode;
}

export interface QuizAnswer {
  answerIndices: number[];
  textAnswer?: string;
  confidence?: number;
  explanation?: string;
}

export interface WrongQuizAnswer {
  answerIndices: number[];
  textAnswer?: string;
}
