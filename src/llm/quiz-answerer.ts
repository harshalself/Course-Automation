import { z } from "zod";

import { logger } from "../logger";
import { LlmConfig, QuizAnswer, QuizSnapshot } from "../types";

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

const QuizAnswerResponseSchema = z.object({
  answerIndices: z.array(z.union([z.number(), z.string()])).default([]),
  textAnswer: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  explanation: z.string().nullable().optional(),
});

const quizAnswerJsonSchema = {
  type: "object",
  properties: {
    answerIndices: {
      type: "array",
      description:
        "Zero-based indexes of the selected options. Use one index for single-choice questions.",
      items: {
        anyOf: [{ type: "number" }, { type: "string" }],
      },
    },
    textAnswer: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Answer text for text-response questions, otherwise null.",
    },
    confidence: {
      anyOf: [{ type: "number" }, { type: "null" }],
      description: "Confidence from 0 to 1.",
    },
    explanation: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "Very short reason for the selected answer. Use 12 words or fewer, or null.",
    },
  },
  required: ["answerIndices", "textAnswer", "confidence", "explanation"],
  additionalProperties: false,
};

export async function answerQuizWithLlm(
  snapshot: QuizSnapshot,
  llm: LlmConfig,
): Promise<QuizAnswer | null> {
  if (!llm.apiKey) {
    logger.warn(`No API key configured for ${llm.provider} llm provider.`);
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), llm.timeoutMs);

  try {
    const response = await fetch(`${trimTrailingSlash(llm.baseUrl)}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: buildHeaders(llm),
      body: JSON.stringify({
        model: llm.model,
        temperature: llm.temperature,
        response_format: buildResponseFormat(llm),
        messages: [
          {
            role: "system",
            content:
              "You answer multiple-choice QA test questions. Return only strict JSON with answerIndices, textAnswer, confidence, and explanation. answerIndices must use zero-based option indexes. Keep explanation null or 12 words or fewer to minimize output tokens.",
          },
          {
            role: "user",
            content: buildPrompt(snapshot),
          },
        ],
      }),
    });

    const body = (await response.json()) as ChatCompletionResponse;
    if (!response.ok) {
      logger.warn(
        `${llm.provider} request failed: ${
          body.error?.message ?? response.statusText
        }`,
      );
      return null;
    }

    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      logger.warn(`${llm.provider} returned no message content.`);
      return null;
    }

    const parsed = QuizAnswerResponseSchema.safeParse(parseJsonObject(content));
    if (!parsed.success) {
      logger.warn(
        `${llm.provider} response did not match quiz answer schema: ${parsed.error.message}`,
      );
      return null;
    }

    return normalizeAnswer(parsed.data, snapshot);
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `${llm.provider} request timed out after ${llm.timeoutMs}ms`
        : `${llm.provider} request failed: ${(error as Error).message}`;
    logger.warn(message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildHeaders(llm: LlmConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${llm.apiKey}`,
    "Content-Type": "application/json",
  };

  if (llm.provider === "openrouter") {
    if (llm.siteUrl) {
      headers["HTTP-Referer"] = llm.siteUrl;
    }

    if (llm.appName) {
      headers["X-OpenRouter-Title"] = llm.appName;
    }
  }

  return headers;
}

function buildResponseFormat(llm: LlmConfig): object {
  if (llm.structuredOutputMode === "json_object") {
    return { type: "json_object" };
  }

  return {
    type: "json_schema",
    json_schema: {
      name: "quiz_answer",
      strict: true,
      schema: quizAnswerJsonSchema,
    },
  };
}

function buildPrompt(snapshot: QuizSnapshot): string {
  const options = snapshot.options
    .map((option, index) => `${index}: ${option}`)
    .join("\n");

  return [
    `Question:\n${snapshot.question}`,
    snapshot.options.length > 0 ? `Options:\n${options}` : "Options: none",
    `Multiple selections allowed: ${snapshot.isMultiSelect}`,
    `Text response field present: ${snapshot.hasTextResponse}`,
    "Return JSON like {\"answerIndices\":[0],\"textAnswer\":null,\"confidence\":0.82,\"explanation\":null}.",
    "For single-choice questions, return exactly one index. For multi-select questions, return every correct index. For text response questions, put the response in textAnswer.",
    "Keep explanation null unless useful; if included, use 12 words or fewer.",
  ].join("\n\n");
}

function parseJsonObject(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?|```$/g, "").trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }

    throw new Error("Could not parse JSON from LLM response.");
  }
}

function normalizeAnswer(
  raw: unknown,
  snapshot: QuizSnapshot,
): QuizAnswer | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const rawIndicesSource = Array.isArray(record.answerIndices)
    ? record.answerIndices
    : Array.isArray(record.indices)
      ? record.indices
      : Array.isArray(record.answers)
        ? record.answers
        : record.answer !== undefined
          ? [record.answer]
          : [];

  const answerIndices = rawIndicesSource
    .map((value) => parseAnswerIndex(value))
    .filter(
      (value, index, values) =>
        Number.isInteger(value) &&
        value >= 0 &&
        value < snapshot.options.length &&
        values.indexOf(value) === index,
    );

  if (!snapshot.isMultiSelect && answerIndices.length > 1) {
    answerIndices.splice(1);
  }

  const textAnswer =
    typeof record.textAnswer === "string" && record.textAnswer.trim()
      ? record.textAnswer.trim()
      : undefined;
  const confidence =
    typeof record.confidence === "number" ? record.confidence : undefined;
  const explanation =
    typeof record.explanation === "string" && record.explanation.trim()
      ? record.explanation.trim().split(/\s+/).slice(0, 12).join(" ")
      : undefined;

  if (answerIndices.length === 0 && !textAnswer) {
    return null;
  }

  return { answerIndices, textAnswer, confidence, explanation };
}

function parseAnswerIndex(value: unknown): number {
  if (typeof value === "number") {
    return Math.trunc(value);
  }

  if (typeof value !== "string") {
    return NaN;
  }

  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  const letter = trimmed.match(/^[A-Za-z]$/)?.[0];
  if (letter) {
    return letter.toUpperCase().charCodeAt(0) - "A".charCodeAt(0);
  }

  return NaN;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
