import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import { LlmProvider, LlmStructuredOutputMode, QuizMode } from "./types";

function loadConfigJson() {
  try {
    const configPath = path.resolve(process.cwd(), "config.json");
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, "utf-8");
      return JSON.parse(content);
    }
  } catch (error) {
    console.warn("Failed to load config.json, using defaults.", error);
  }
  return {};
}

const fileConfig = loadConfigJson();

function parseQuizMode(value: string | undefined): QuizMode {
  if (value === "llm") {
    return "llm";
  }

  return "manual";
}

function parseLlmProvider(value: string | undefined): LlmProvider {
  if (value === "ollama" || value === "lmstudio") {
    return value;
  }

  return "openrouter";
}

function getDefaultBaseUrl(provider: LlmProvider): string {
  if (provider === "ollama") {
    return "http://localhost:11434/v1";
  }

  if (provider === "lmstudio") {
    return "http://localhost:1234/v1";
  }

  return "https://openrouter.ai/api/v1";
}

function getDefaultModel(provider: LlmProvider): string {
  if (provider === "ollama") {
    return "llama3.2";
  }

  if (provider === "lmstudio") {
    return "local-model";
  }

  return "cohere/command-a";
}

function getDefaultApiKey(provider: LlmProvider): string | undefined {
  if (provider === "ollama") {
    return "ollama";
  }

  if (provider === "lmstudio") {
    return "lm-studio";
  }

  return undefined;
}

function getDefaultStructuredOutputMode(
  provider: LlmProvider,
): LlmStructuredOutputMode {
  return provider === "ollama" ? "json_object" : "json_schema";
}

function parsePositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.trunc(value));
}

const llmProvider = parseLlmProvider(
  fileConfig.llmProvider ?? fileConfig.llm?.provider,
);

export const config = {
  baseUrl: fileConfig.courseBaseUrl ?? "https://eranx.mkcl.org/learner/login",
  username: process.env.COURSE_USER,
  password: process.env.COURSE_PASS,
  headless: fileConfig.headless ?? false,
  slowMoMs: fileConfig.slowMoMs ?? 150,
  loopDelayMs: fileConfig.loopDelayMs ?? 1200,
  maxLoopIterations: fileConfig.maxLoopIterations ?? 100,

  quizMode: parseQuizMode(fileConfig.quizMode),
  autoSubmitQuiz: fileConfig.autoSubmitQuiz ?? true,
  llmMaxAnswerAttempts: parsePositiveInteger(
    fileConfig.llmMaxAnswerAttempts ?? fileConfig.llm?.maxAnswerAttempts,
    2,
  ),
  llm: {
    provider: llmProvider,
    apiKey:
      process.env.LLM_API_KEY ??
      fileConfig.llmApiKey ??
      fileConfig.llm?.apiKey ??
      getDefaultApiKey(llmProvider),
    model:
      fileConfig.llmModel ??
      fileConfig.llm?.model ??
      getDefaultModel(llmProvider),
    baseUrl:
      fileConfig.llmBaseUrl ??
      fileConfig.llm?.baseUrl ??
      getDefaultBaseUrl(llmProvider),
    siteUrl: fileConfig.llmSiteUrl ?? fileConfig.llm?.siteUrl,
    appName:
      fileConfig.llmAppName ??
      fileConfig.llm?.appName ??
      "Course Automation Everywhere",
    temperature:
      fileConfig.llmTemperature ??
      fileConfig.llm?.temperature ??
      0,
    timeoutMs:
      fileConfig.llmTimeoutMs ??
      fileConfig.llm?.timeoutMs ??
      45000,
    structuredOutputMode:
      fileConfig.llmStructuredOutputMode ??
      fileConfig.llm?.structuredOutputMode ??
      getDefaultStructuredOutputMode(llmProvider),
  },
  stopOnAssignment: fileConfig.stopOnAssignment ?? true,
  videoScriptFile: fileConfig.videoScriptFile ?? "scripts/video-complete.js",
  notifyOnStop: fileConfig.notifyOnStop ?? true,
  stopSoundFile:
    fileConfig.stopSoundFile ?? "/System/Library/Sounds/Glass.aiff",

  stateFile: fileConfig.stateFile ?? "runtime/state.json",
};
