export type QuizMode = "manual" | "answer-key";

export interface QuizSnapshot {
  question: string;
  options: string[];
  isMultiSelect: boolean;
  hasTextResponse: boolean;
}

export interface QuizSuggestion {
  selectedOptions: string[];
  textAnswer?: string;
  confidence?: number;
  reason?: string;
}
