import fs from "fs";
import path from "path";

const LOG_DIR = path.join(process.cwd(), "logs");

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// One combined file + level-specific files
const ALL_LOG    = path.join(LOG_DIR, "all.log");
const INFO_LOG   = path.join(LOG_DIR, "info.log");
const WARN_LOG   = path.join(LOG_DIR, "warn.log");
const ERROR_LOG  = path.join(LOG_DIR, "error.log");

// Rotate logs on startup so each run has a clean slate
for (const f of [ALL_LOG, INFO_LOG, WARN_LOG, ERROR_LOG]) {
  try { fs.writeFileSync(f, `--- Run started at ${new Date().toISOString()} ---\n`); } catch (_) {}
}

function now(): string {
  return new Date().toISOString();
}

function write(level: "INFO" | "WARN" | "ERROR", message: string): void {
  const line = `[${now()}] [${level}] ${message}\n`;

  // Always print to stdout
  process.stdout.write(line);

  // Write to combined log
  try { fs.appendFileSync(ALL_LOG, line); } catch (_) {}

  // Write to level-specific log
  const levelFile = level === "INFO" ? INFO_LOG : level === "WARN" ? WARN_LOG : ERROR_LOG;
  try { fs.appendFileSync(levelFile, line); } catch (_) {}
}

export const logger = {
  info(message: string): void {
    write("INFO", message);
  },
  warn(message: string): void {
    write("WARN", message);
  },
  error(message: string): void {
    write("ERROR", message);
  },
};
