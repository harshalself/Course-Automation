import { logger } from "../logger";
import { OpenRouterConfig, QuizAnswer, QuizSnapshot } from "../types";

interface OpenRouterChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

export async function answerQuizWithOpenRouter(
  snapshot: QuizSnapshot,
  openRouter: OpenRouterConfig,
): Promise<QuizAnswer | null> {
  if (!openRouter.apiKey) {
    logger.warn(
      "OPENROUTER_API_KEY is not configured; cannot use llm quiz mode.",
    );
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), openRouter.timeoutMs);

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        signal: controller.signal,
        headers: buildHeaders(openRouter),
        body: JSON.stringify({
          model: openRouter.model,
          temperature: openRouter.temperature,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You answer multiple-choice QA test questions. Return only strict JSON with answerIndices, textAnswer, confidence, and explanation. answerIndices must use zero-based option indexes.",
            },
            {
              role: "user",
              content: buildPrompt(snapshot),
            },
          ],
        }),
      },
    );

    const body = (await response.json()) as OpenRouterChatResponse;
    if (!response.ok) {
      logger.warn(
        `OpenRouter request failed: ${
          body.error?.message ?? response.statusText
        }`,
      );
      return null;
    }

    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      logger.warn("OpenRouter returned no message content.");
      return null;
    }

    return normalizeAnswer(parseJsonObject(content), snapshot);
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `OpenRouter request timed out after ${openRouter.timeoutMs}ms`
        : `OpenRouter request failed: ${(error as Error).message}`;
    logger.warn(message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildHeaders(openRouter: OpenRouterConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${openRouter.apiKey}`,
    "Content-Type": "application/json",
  };

  if (openRouter.siteUrl) {
    headers["HTTP-Referer"] = openRouter.siteUrl;
  }

  if (openRouter.appName) {
    headers["X-OpenRouter-Title"] = openRouter.appName;
  }

  return headers;
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
    "Return JSON like {\"answerIndices\":[0],\"textAnswer\":null,\"confidence\":0.82,\"explanation\":\"brief reason\"}.",
    "For single-choice questions, return exactly one index. For multi-select questions, return every correct index. For text response questions, put the response in textAnswer.",
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

    throw new Error("Could not parse JSON from OpenRouter response.");
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
      ? record.explanation.trim()
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
