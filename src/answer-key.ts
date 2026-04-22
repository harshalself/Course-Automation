import fs from "node:fs/promises";
import path from "node:path";

import { logger } from "./logger";
import { normalizeText } from "./text";
import { QuizSuggestion } from "./types";

interface RawEntry {
  question: string;
  selectedOptions?: string[];
  textAnswer?: string;
}

interface RawAnswerKey {
  entries?: RawEntry[];
}

export class AnswerKeyStore {
  private readonly entries = new Map<string, QuizSuggestion>();

  constructor(private readonly filePath: string) {}

  async load(): Promise<boolean> {
    const resolvedPath = path.resolve(this.filePath);
    try {
      const raw = await fs.readFile(resolvedPath, "utf8");
      const parsed = JSON.parse(raw) as RawAnswerKey;
      const entryList = parsed.entries ?? [];

      for (const entry of entryList) {
        if (!entry.question || typeof entry.question !== "string") {
          continue;
        }
        const normalizedQuestion = normalizeText(entry.question);
        if (!normalizedQuestion) {
          continue;
        }

        const selectedOptions = Array.isArray(entry.selectedOptions)
          ? entry.selectedOptions.filter((option) => typeof option === "string")
          : [];

        const suggestion: QuizSuggestion = {
          selectedOptions,
          textAnswer:
            typeof entry.textAnswer === "string" ? entry.textAnswer : undefined,
          reason: "answer-key",
        };
        this.entries.set(normalizedQuestion, suggestion);
      }

      logger.info(
        `Loaded ${this.entries.size} answer-key entries from ${resolvedPath}`,
      );
      return true;
    } catch (error) {
      logger.warn(`Answer-key file not loaded: ${(error as Error).message}`);
      return false;
    }
  }

  lookup(question: string): QuizSuggestion | null {
    const normalizedQuestion = normalizeText(question);
    if (!normalizedQuestion) {
      return null;
    }

    const exact = this.entries.get(normalizedQuestion);
    if (exact) {
      return exact;
    }

    for (const [storedQuestion, value] of this.entries) {
      if (
        normalizedQuestion.includes(storedQuestion) ||
        storedQuestion.includes(normalizedQuestion)
      ) {
        return value;
      }
    }

    return null;
  }
}
