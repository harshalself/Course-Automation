export type QuizMode = "manual";

export interface QuizSnapshot {
  question: string;
  options: string[];
  isMultiSelect: boolean;
  hasTextResponse: boolean;
}
