import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import { QuizMode } from "./types";

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
  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY ?? fileConfig.openRouterApiKey,
    model:
      fileConfig.openRouterModel ??
      fileConfig.openRouter?.model ??
      "google/gemini-2.5-flash",
    siteUrl: fileConfig.openRouterSiteUrl ?? fileConfig.openRouter?.siteUrl,
    appName:
      fileConfig.openRouterAppName ??
      fileConfig.openRouter?.appName ??
      "Course Automation Everywhere",
    temperature:
      fileConfig.openRouterTemperature ??
      fileConfig.openRouter?.temperature ??
      0,
    timeoutMs:
      fileConfig.openRouterTimeoutMs ??
      fileConfig.openRouter?.timeoutMs ??
      45000,
  },
  stopOnAssignment: fileConfig.stopOnAssignment ?? true,
  videoScriptFile: fileConfig.videoScriptFile ?? "scripts/video-complete.js",
  notifyOnStop: fileConfig.notifyOnStop ?? true,
  stopSoundFile:
    fileConfig.stopSoundFile ?? "/System/Library/Sounds/Glass.aiff",

  stateFile: fileConfig.stateFile ?? "runtime/state.json",
};
