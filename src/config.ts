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
  const normalized = (value ?? "manual").trim().toLowerCase();
  if (normalized === "answer-key") {
    return "answer-key";
  }
  return "manual";
}

export const config = {
  baseUrl: fileConfig.lmsBaseUrl ?? "https://eranx.mkcl.org/learner/login",
  username: process.env.LMS_USERNAME,
  password: process.env.LMS_PASSWORD,
  headless: fileConfig.headless ?? false,
  slowMoMs: fileConfig.slowMoMs ?? 150,
  loopDelayMs: fileConfig.loopDelayMs ?? 1200,
  maxLoopIterations: fileConfig.maxLoopIterations ?? 100,

  quizMode: parseQuizMode(fileConfig.quizMode),
  autoSubmitQuiz: fileConfig.autoSubmitQuiz ?? true,
  stopOnAssignment: fileConfig.stopOnAssignment ?? true,
  answerKeyFile: fileConfig.answerKeyFile ?? "data/answer-key.json",
  videoScriptFile: fileConfig.videoScriptFile ?? "scripts/video-complete.js",

  stateFile: fileConfig.stateFile ?? "runtime/state.json",
};
