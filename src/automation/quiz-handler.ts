import { Page } from "playwright";

import { config } from "../config";
import { answerQuizWithOpenRouter } from "../llm/openrouter";
import { logger } from "../logger";
import { QuizMode, QuizSnapshot } from "../types";
import { isVisible, tryMoveToNext } from "./dom-actions";

type AssignmentStepDetector = (page: Page) => Promise<boolean>;

export async function handleQuizQuestion(
  page: Page,
  mode: QuizMode,
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

    if (mode === "llm") {
      const llmResult = await answerQuestionWithLlm(
        page,
        snapshot,
        questionCount,
      );
      if (llmResult === "selected-only") {
        return true;
      }

      if (llmResult === "resolved") {
        await page.waitForTimeout(2000);
        continue;
      }

      logger.warn(
        `[Quiz Q${questionCount}] LLM answer unavailable or did not resolve the question. Stopping quiz handling without brute-force attempts.`,
      );
      return true;
    }

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

      const beforeSignature = await getQuizStepSignature(page);

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
      await page.waitForTimeout(700);

      let submitted = false;

      const checkBtn = page
        .locator("button")
        .filter({ hasText: /^check$|^verify$/i })
        .first();
      if (await isVisible(checkBtn)) {
        await checkBtn.click({ force: true });
        submitted = true;
        await page.waitForTimeout(700);
      }

      let submitPattern = "unknown";
      for (const pat of [
        /save\s*(&|and)?\s*next/i,
        /^next$/i,
        /^continue$/i,
        /^submit$/i,
        /^finish$/i,
      ]) {
        const btn = page.locator("button").filter({ hasText: pat }).first();
        if ((await isVisible(btn)) && !(await btn.isDisabled())) {
          await btn.click({ force: true });
          submitted = true;
          submitPattern = String(pat);
          break;
        }
      }

      if (!submitted) {
        logger.warn(
          `[Quiz Q${questionCount}] Option ${optIdx}: no submit/check button available.`,
        );
        continue;
      }

      await page.waitForTimeout(1200);

      if (await confirmEndExamDialog(page, questionCount, optIdx)) {
        questionResolved = true;
        break;
      }

      const afterSignature = await getQuizStepSignature(page);
      if (afterSignature !== beforeSignature) {
        logger.info(
          `[Quiz Q${questionCount}] Option ${optIdx} accepted. Question advanced after ${submitPattern}.`,
        );
        questionResolved = true;
        break;
      }

      const tryAgainNow = page
        .locator("button")
        .filter({ hasText: /try\s*again|retry/i })
        .first();
      const hasTryAgain = await tryAgainNow.isVisible().catch(() => false);
      const hasWrongFeedback = await hasWrongAnswerFeedback(page);

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
        continue;
      }

      if (hasWrongFeedback) {
        if (attempt < optionOrder.length - 1) {
          logger.info(
            `[Quiz Q${questionCount}] Option ${optIdx} WRONG (toast feedback). Trying next option...`,
          );
        } else {
          logger.warn(
            `[Quiz Q${questionCount}] Option ${optIdx} appears WRONG (toast feedback) and it was the LAST option.`,
          );
        }
        continue;
      }

      if (attempt < optionOrder.length - 1) {
        logger.warn(
          `[Quiz Q${questionCount}] Option ${optIdx}: question did not advance and no explicit feedback. Trying next option...`,
        );
      } else {
        logger.warn(
          `[Quiz Q${questionCount}] Option ${optIdx}: no advance/feedback and this was the LAST option.`,
        );
      }
    }

    if (!questionResolved) {
      logger.warn(
        `[Quiz Q${questionCount}] Could not resolve question from available options. Trying footer Next as last resort.`,
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

async function answerQuestionWithLlm(
  page: Page,
  snapshot: QuizSnapshot,
  questionCount: number,
): Promise<"resolved" | "selected-only" | "unresolved"> {
  logger.info(
    `[Quiz Q${questionCount}] Asking OpenRouter model ${config.openRouter.model} for an answer.`,
  );

  const answer = await answerQuizWithOpenRouter(snapshot, config.openRouter);
  if (!answer) {
    return "unresolved";
  }

  const confidence =
    answer.confidence === undefined
      ? ""
      : ` confidence=${answer.confidence.toFixed(2)}`;
  logger.info(
    `[Quiz Q${questionCount}] LLM selected indices [${answer.answerIndices.join(
      ", ",
    )}]${confidence}.`,
  );
  if (answer.explanation) {
    logger.info(
      `[Quiz Q${questionCount}] LLM explanation: ${answer.explanation.slice(
        0,
        220,
      )}`,
    );
  }

  const beforeSignature = await getQuizStepSignature(page);
  const selected = await applyLlmAnswer(page, snapshot, answer);
  if (!selected) {
    return "unresolved";
  }

  if (!config.autoSubmitQuiz) {
    logger.info(
      `[Quiz Q${questionCount}] Answer selected. autoSubmitQuiz=false, leaving submission to the operator.`,
    );
    return "selected-only";
  }

  const submitted = await submitCurrentAnswer(page);
  if (!submitted) {
    logger.warn(
      `[Quiz Q${questionCount}] LLM answer selected, but no submit/check/next button was available.`,
    );
    return "unresolved";
  }

  await page.waitForTimeout(1200);

  if (
    await confirmEndExamDialog(
      page,
      questionCount,
      answer.answerIndices[0] ?? -1,
    )
  ) {
    return "resolved";
  }

  const afterSignature = await getQuizStepSignature(page);
  if (afterSignature !== beforeSignature) {
    logger.info(
      `[Quiz Q${questionCount}] LLM answer accepted; question advanced.`,
    );
    return "resolved";
  }

  const tryAgainNow = page
    .locator("button")
    .filter({ hasText: /try\s*again|retry/i })
    .first();
  if (await tryAgainNow.isVisible().catch(() => false)) {
    logger.warn(`[Quiz Q${questionCount}] LLM answer appears incorrect.`);
    await tryAgainNow.click({ force: true });
    await page.waitForTimeout(1000);
    return "unresolved";
  }

  if (await hasWrongAnswerFeedback(page)) {
    logger.warn(
      `[Quiz Q${questionCount}] LLM answer received wrong-answer feedback.`,
    );
    return "unresolved";
  }

  logger.warn(
    `[Quiz Q${questionCount}] LLM answer was submitted, but the page did not clearly advance.`,
  );
  return "unresolved";
}

async function applyLlmAnswer(
  page: Page,
  snapshot: QuizSnapshot,
  answer: { answerIndices: number[]; textAnswer?: string },
): Promise<boolean> {
  let selected = false;

  if (snapshot.hasTextResponse && answer.textAnswer) {
    const textInput = page.locator("textarea, input[type='text']").first();
    if (await isVisible(textInput)) {
      await textInput.fill(answer.textAnswer);
      selected = true;
    }
  }

  if (answer.answerIndices.length === 0) {
    return selected;
  }

  const radioCount = await page.locator("input[type='radio']").count();
  const checkboxCount = await page.locator("input[type='checkbox']").count();
  const optionSelector =
    radioCount > 0 ? "input[type='radio']" : "input[type='checkbox']";
  const optionCount = radioCount > 0 ? radioCount : checkboxCount;

  for (const index of answer.answerIndices) {
    if (index < 0 || index >= optionCount) {
      continue;
    }

    const option = page.locator(optionSelector).nth(index);
    if (!(await isVisible(option))) {
      logger.warn(`[Quiz] LLM-selected option ${index} is not visible.`);
      continue;
    }

    await option.setChecked(true, { force: true });
    selected = true;
    await page.waitForTimeout(250);
  }

  return selected;
}

async function submitCurrentAnswer(page: Page): Promise<boolean> {
  const checkBtn = page
    .locator("button")
    .filter({ hasText: /^check$|^verify$/i })
    .first();
  if (await isVisible(checkBtn)) {
    await checkBtn.click({ force: true });
    await page.waitForTimeout(700);
  }

  for (const pat of [
    /save\s*(&|and)?\s*next/i,
    /^next$/i,
    /^continue$/i,
    /^submit$/i,
    /^finish$/i,
  ]) {
    const btn = page.locator("button").filter({ hasText: pat }).first();
    if ((await isVisible(btn)) && !(await btn.isDisabled())) {
      await btn.click({ force: true });
      return true;
    }
  }

  return await isVisible(checkBtn);
}

async function getQuizStepSignature(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const questionCandidates = [
      "[class*='question'] h4",
      "[class*='question'] h3",
      "[class*='question'] h2",
      ".question h4",
      ".question h3",
      ".question h2",
      "legend",
      "h4",
      "h3",
    ];

    let questionText = "";
    for (const selector of questionCandidates) {
      const node = document.querySelector(selector);
      const text = (node?.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text.length > 8) {
        questionText = text;
        break;
      }
    }

    let progressText = "";
    const progressNodes = document.querySelectorAll("p, span, div");
    for (const node of progressNodes) {
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      if (/^\d+\s*\/\s*\d+$/.test(text)) {
        progressText = text;
        break;
      }
    }

    return `${progressText || "?/?"}|${questionText.slice(0, 220)}`;
  });
}

async function hasWrongAnswerFeedback(page: Page): Promise<boolean> {
  const wrongAlert = page
    .locator("[role='alert'], .p-toast-message, .toast-message")
    .filter({ hasText: /wrong\s*answer|incorrect|try\s*again/i })
    .first();

  if (await wrongAlert.isVisible().catch(() => false)) {
    return true;
  }

  return await page.evaluate(() => {
    const text = (document.body?.innerText ?? "").toLowerCase();
    return (
      text.includes("wrong answer") ||
      text.includes("incorrect") ||
      text.includes("try again")
    );
  });
}

async function confirmEndExamDialog(
  page: Page,
  questionCount: number,
  optIdx: number,
): Promise<boolean> {
  const dialog = page
    .locator(".p-dialog, .p-confirm-dialog, [role='dialog']")
    .filter({
      hasText: /end\s*exam|attempted all questions|you have attempted/i,
    })
    .first();

  const isVisibleNow = await dialog.isVisible().catch(() => false);
  if (!isVisibleNow) {
    return false;
  }

  const yesButton = dialog
    .locator("button")
    .filter({ hasText: /^yes$|confirm|ok/i })
    .first();

  if (await yesButton.isVisible().catch(() => false)) {
    logger.info(
      `[Quiz Q${questionCount}] Option ${optIdx} appears correct. End Exam confirmation visible, clicking Yes.`,
    );
    await yesButton.click({ force: true });
    await page.waitForTimeout(1500);
    return true;
  }

  return false;
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
