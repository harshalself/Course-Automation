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

async function main(): Promise<void> {
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
