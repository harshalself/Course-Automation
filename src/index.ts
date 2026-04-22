import { CourseAutomation } from "./automation";
import { logger } from "./logger";

async function main(): Promise<void> {
  const automation = new CourseAutomation();
  await automation.run();
}

main().catch((error) => {
  logger.error(`Fatal error: ${(error as Error).message}`);
  process.exitCode = 1;
});
