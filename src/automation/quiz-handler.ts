import { Page } from "playwright";

import { logger } from "../logger";
import { QuizMode, QuizSnapshot } from "../types";
import { isVisible, tryMoveToNext } from "./dom-actions";

type AssignmentStepDetector = (page: Page) => Promise<boolean>;

export async function handleQuizQuestion(
  page: Page,
  _mode: QuizMode,
  isAssignmentStep: AssignmentStepDetector,
): Promise<boolean> {
  const MAX_QUESTIONS = 60;
  let questionCount = 0;

  while (questionCount < MAX_QUESTIONS) {
    const stillQuiz = await page.evaluate(() => {
      const radios = document.querySelectorAll("input[type='radio']").length;
      const checkboxes = document.querySelectorAll(
        "input[type='checkbox']",
      ).length;
      const textResponses = document.querySelectorAll(
        "textarea, input[type='text']",
      ).length;
      return radios + checkboxes + textResponses > 0;
    });

    if (!stillQuiz) {
      logger.info(
        `Quiz inner loop exited after ${questionCount} questions - no more inputs found.`,
      );
      break;
    }

    questionCount += 1;
    const snapshot = await extractQuizSnapshot(page, isAssignmentStep);
    if (!snapshot) {
      logger.warn("Could not extract quiz snapshot, stopping inner loop.");
      break;
    }

    logger.info(`[Quiz Q${questionCount}] ${snapshot.question.slice(0, 100)}`);

    let questionResolved = false;
    const radioCount = await page.locator("input[type='radio']").count();
    const checkboxCount = await page.locator("input[type='checkbox']").count();

    logger.info(
      `[Quiz Q${questionCount}] Trying options sequentially. Total options: ${radioCount || checkboxCount}`,
    );

    const optionCount = radioCount > 0 ? radioCount : checkboxCount;
    const optionSelector =
      radioCount > 0 ? "input[type='radio']" : "input[type='checkbox']";

    const optionOrder = Array.from(
      { length: optionCount },
      (_, index) => index,
    );

    for (let attempt = 0; attempt < optionOrder.length; attempt += 1) {
      const optIdx = optionOrder[attempt];
      if (optIdx === undefined) {
        continue;
      }

      const option = page.locator(optionSelector).nth(optIdx);
      if (!(await isVisible(option))) {
        logger.warn(
          `[Quiz Q${questionCount}] Option ${optIdx} not visible, skipping...`,
        );
        continue;
      }

      logger.info(
        `[Quiz Q${questionCount}] Selecting option index ${optIdx}...`,
      );
      await option.click({ force: true });
      await page.waitForTimeout(1500);

      const checkBtn = page
        .locator("button")
        .filter({ hasText: /^check$|^verify$/i })
        .first();
      if (await isVisible(checkBtn)) {
        await checkBtn.click({ force: true });
        await page.waitForTimeout(1500);
      }

      let advanced = false;
      for (const pat of [
        /save\s*(&|and)?\s*next/i,
        /^next$/i,
        /^continue$/i,
        /^submit$/i,
      ]) {
        const btn = page.locator("button").filter({ hasText: pat }).first();
        if ((await isVisible(btn)) && !(await btn.isDisabled())) {
          logger.info(
            `[Quiz Q${questionCount}] Option ${optIdx} CORRECT! Advancing with: ${pat}`,
          );
          await btn.click({ force: true });
          advanced = true;
          break;
        }
      }
      if (advanced) {
        questionResolved = true;
        break;
      }

      const tryAgainNow = page
        .locator("button")
        .filter({ hasText: /try\s*again|retry/i })
        .first();
      const endExamNow = page
        .locator("button")
        .filter({ hasText: /end\s*exam|finish/i })
        .first();
      const hasTryAgain = await tryAgainNow.isVisible().catch(() => false);
      const hasEndExam = await endExamNow.isVisible().catch(() => false);

      if (hasEndExam && !hasTryAgain) {
        await page.waitForTimeout(800);
        const retryConfirm = await tryAgainNow.isVisible().catch(() => false);
        if (!retryConfirm) {
          logger.info(
            `[Quiz Q${questionCount}] Option ${optIdx} CORRECT (last Q confirmed). Clicking End Exam...`,
          );
          await endExamNow.click({ force: true });
          questionResolved = true;
          break;
        }
      }

      if (hasTryAgain) {
        if (attempt < optionOrder.length - 1) {
          const nextCandidate = optionOrder[attempt + 1];
          logger.info(
            `[Quiz Q${questionCount}] Option ${optIdx} WRONG. Clicking Try Again -> will try option ${nextCandidate}...`,
          );
        } else {
          logger.warn(
            `[Quiz Q${questionCount}] Option ${optIdx} WRONG and it was the LAST option. Clicking Try Again anyway...`,
          );
        }
        await tryAgainNow.click({ force: true });
        await page.waitForTimeout(1000);
      } else {
        logger.warn(
          `[Quiz Q${questionCount}] Option ${optIdx}: no feedback buttons visible. Breaking.`,
        );
        break;
      }
    }

    if (!questionResolved) {
      const anyBtn = page
        .getByRole("button", { name: /save|next|submit|continue/i })
        .first();
      if (await isVisible(anyBtn)) {
        await anyBtn.click({ force: true });
        questionResolved = true;
        logger.info(`[Quiz Q${questionCount}] Clicked via getByRole fallback.`);
      }
    }

    if (!questionResolved) {
      logger.warn(
        `[Quiz Q${questionCount}] No navigation button found after answering. Trying footer Next as last resort.`,
      );
      await tryMoveToNext(page);
      await page.waitForTimeout(2000);
      break;
    }

    await page.waitForTimeout(2000);

    const yesBtn = page
      .locator(".p-confirm-dialog button, .p-dialog button")
      .filter({ hasText: /yes|confirm|ok/i })
      .first();
    if (await isVisible(yesBtn)) {
      logger.info("Confirm dialog — clicking Yes.");
      await yesBtn.click();
      await page.waitForTimeout(2000);
      break;
    }
  }

  logger.info(
    "Quiz inner loop complete. Clicking footer Next to advance past results page...",
  );
  await page.waitForTimeout(2000);
  await tryMoveToNext(page);
  return true;
}

async function extractQuizSnapshot(
  page: Page,
  isAssignmentStep: AssignmentStepDetector,
): Promise<QuizSnapshot | null> {
  if (await isAssignmentStep(page)) {
    return null;
  }

  const radioCount = await page.locator("input[type='radio']").count();
  const checkboxCount = await page.locator("input[type='checkbox']").count();
  const hasTextResponse =
    (await page.locator("textarea, input[type='text']").count()) > 0;

  const options = await page.evaluate(() => {
    const result: string[] = [];
    const seen = new Set<string>();

    const labels = Array.from(document.querySelectorAll("label"));
    for (const label of labels) {
      const text = (label.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 220) {
        continue;
      }

      const linkedInputId = (label as HTMLLabelElement).htmlFor;
      const linkedInput = linkedInputId
        ? document.getElementById(linkedInputId)
        : null;
      const hasChoiceInput =
        label.querySelector("input[type='radio'], input[type='checkbox']") !==
          null ||
        linkedInput?.matches("input[type='radio'], input[type='checkbox']");

      if (!hasChoiceInput || seen.has(text)) {
        continue;
      }

      seen.add(text);
      result.push(text);
    }

    return result.slice(0, 12);
  });

  const hasChoiceInputs = radioCount + checkboxCount > 0;
  if (!hasChoiceInputs && !hasTextResponse) {
    return null;
  }

  const question = await page.evaluate(() => {
    const candidates = [
      "[class*='question']",
      ".question",
      "legend",
      "h1",
      "h2",
      "h3",
    ];

    for (const selector of candidates) {
      const node = document.querySelector(selector);
      const text = (node?.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text && text.length > 8) {
        return text;
      }
    }

    const bodyText =
      document.body?.innerText?.replace(/\s+/g, " ").trim() ?? "";
    return bodyText.slice(0, 280);
  });

  return {
    question,
    options,
    isMultiSelect: checkboxCount > 0 && radioCount === 0,
    hasTextResponse,
  };
}
