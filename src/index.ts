import { execFileSync } from "node:child_process";

import { CourseAutomation } from "./automation";
import { config } from "./config";
import { logger } from "./logger";

let notifiedOnStop = false;

function playStopNotification(): void {
  if (!config.notifyOnStop || notifiedOnStop) {
    return;
  }

  notifiedOnStop = true;

  // Terminal bell fallback.
  process.stdout.write("\u0007");

  if (process.platform !== "darwin") {
    return;
  }

  try {
    execFileSync("afplay", [config.stopSoundFile], { stdio: "ignore" });
  } catch {
    // Bell fallback already triggered.
  }
}

function printBanner(): void {
  console.log("\n" + "=".repeat(60));
  console.log("             COURSE AUTOMATION EVERYWHERE");
  console.log("=".repeat(60));
  console.log("DISCLAIMER: This project is for development and automation");
  console.log("learning purposes ONLY. It does NOT promote cheating or");
  console.log("dishonest practices. Use responsibly and in compliance");
  console.log("with your platform's Terms of Service.");
  console.log("=".repeat(60) + "\n");
}

async function main(): Promise<void> {
  printBanner();
  const automation = new CourseAutomation();

  await automation.run();
}

main()
  .catch((error) => {
    logger.error(`Fatal error: ${(error as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    playStopNotification();
  });
