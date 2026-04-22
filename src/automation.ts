import fs from "node:fs/promises";
import path from "node:path";

import { Browser, chromium, Page } from "playwright";

import {
  clickAction,
  firstVisible,
  isVisible,
  tryMoveToNext,
} from "./automation/dom-actions";
import { handleContentViewerInit } from "./automation/content-viewer-handler";
import { detectPageType } from "./automation/page-type";
import { handleQuizQuestion } from "./automation/quiz-handler";
import { handleVideo } from "./automation/video-handler";
import { config } from "./config";
import { logger } from "./logger";
import { selectors } from "./selectors";
import { RuntimeStateStore } from "./state-store";

export class EraAutomation {
  private readonly state = new RuntimeStateStore(config.stateFile);
  private videoScript: string | null = null;

  async run(): Promise<void> {
    await this.state.load();
    await this.bootstrapProviders();

    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({
        headless: config.headless,
        slowMo: config.slowMoMs,
      });

      const context = await browser.newContext();
      const page = await context.newPage();

      await page.goto(config.baseUrl, { waitUntil: "domcontentloaded" });
      await this.login(page);
      await this.runSequentialLoop(page);
    } finally {
      await this.state.save();
      if (browser) {
        await browser.close();
      }
    }
  }

  private async bootstrapProviders(): Promise<void> {
    if (config.videoScriptFile) {
      try {
        const raw = await fs.readFile(
          path.resolve(config.videoScriptFile),
          "utf8",
        );
        this.videoScript = raw.replace(/^javascript:/i, "").trim();
        logger.info(
          `Loaded custom video script from ${config.videoScriptFile}`,
        );
      } catch (error) {
        logger.warn(
          `Could not load custom video script: ${(error as Error).message}`,
        );
      }
    }
  }

  private async login(page: Page): Promise<void> {
    if (config.username && config.password) {
      let usernameInput = await firstVisible(page, selectors.usernameInputs);
      let passwordInput = await firstVisible(page, selectors.passwordInputs);

      if (usernameInput && passwordInput) {
        await usernameInput.fill(config.username);
        await passwordInput.fill(config.password);
        const clicked = await clickAction(page, [
          /log in/i,
          /login/i,
          /sign in/i,
          /submit/i,
        ]);
        if (clicked) {
          await page.waitForTimeout(2500);
          logger.info(
            "Single-page login submitted using environment credentials",
          );
          return;
        }
      } else if (usernameInput && !passwordInput) {
        await usernameInput.fill(config.username);
        const nextClicked = await clickAction(page, [
          /next/i,
          /continue/i,
          /submit/i,
        ]);
        if (nextClicked) {
          await page.waitForTimeout(2000);
          passwordInput = await firstVisible(page, selectors.passwordInputs);
          if (passwordInput) {
            await passwordInput.fill(config.password);
            const loginClicked = await clickAction(page, [
              /log in/i,
              /login/i,
              /sign in/i,
              /submit/i,
            ]);
            if (loginClicked) {
              await page.waitForTimeout(2500);
              logger.info(
                "Two-step login submitted using environment credentials",
              );
              return;
            }
          }
        }
      }
    }

    logger.info(
      "Could not auto-login completely. Please complete login manually in the opened browser, then press Enter here",
    );
    await this.waitForEnter();
  }

  private async runSequentialLoop(page: Page): Promise<void> {
    logger.info(
      `Starting sequential loop with quizMode=${config.quizMode}, autoSubmitQuiz=${config.autoSubmitQuiz}`,
    );

    for (
      let iteration = 1;
      iteration <= config.maxLoopIterations;
      iteration += 1
    ) {
      const currentUrl = page.url();
      this.state.setLastUrl(currentUrl);
      await this.state.save();

      logger.info(`Step ${iteration} at ${currentUrl}`);

      const pageType = await detectPageType(
        page,
        this.isAssignmentStep.bind(this),
      );
      logger.info(`Detected page type: ${pageType}`);

      if (pageType === "assignment") {
        if (config.stopOnAssignment) {
          this.state.setStopReason("assignment_reached");
          await this.state.save();
          logger.info(
            "Assignment step detected, stopping automation as requested",
          );
          return;
        }
        logger.info(
          "Assignment step detected, but stopOnAssignment=false so continuing flow",
        );
      }

      let handled = false;
      if (pageType === "video") {
        handled = await handleVideo(
          page,
          currentUrl,
          this.state,
          this.videoScript,
        );
      } else if (pageType === "quiz-intro") {
        handled = await this.handleQuizIntro(page);
      } else if (pageType === "quiz-question") {
        handled = await handleQuizQuestion(
          page,
          config.quizMode,
          this.isAssignmentStep.bind(this),
        );
      } else if (pageType === "document") {
        handled = await this.handleDocument(page);
      } else if (pageType === "dashboard-popup") {
        handled = await this.handleDashboardPopup(page);
      } else if (pageType === "dashboard-start") {
        const el = page.getByText(/start learning/i, { exact: false }).first();
        if (await isVisible(el)) {
          await el.click();
          handled = true;
        }
      } else if (pageType === "dashboard-continue") {
        const el = page
          .getByText(/continue learning/i, { exact: false })
          .first();
        if (await isVisible(el)) {
          await el.click();
          handled = true;
        }
      } else if (pageType === "content-viewer-init") {
        handled = await handleContentViewerInit(page);
      } else if (pageType === "dashboard-loading") {
        logger.info(
          "Intermediate OAuth redirect active. Waiting for resolution.",
        );
        await page.waitForTimeout(3000);
        handled = true;
      }

      if (handled) {
        await page.waitForTimeout(config.loopDelayMs);
        continue;
      }

      const moved = await tryMoveToNext(page);
      if (!moved) {
        // Next button locked — LMS may require completing a pending quiz/node first.
        // Attempt tree traversal to find and click the next available item.
        logger.warn(
          "Next button blocked. Attempting tree traversal to find next available node.",
        );
        const treeHandled = await handleContentViewerInit(page, true);
        if (!treeHandled) {
          this.state.setStopReason("no_next_action_found_or_blocked");
          await this.state.save();
          logger.warn("No valid next action or it is blocked. Stopping.");
          return;
        }
      }

      await page.waitForTimeout(config.loopDelayMs);
    }

    this.state.setStopReason("max_loop_iterations_reached");
    await this.state.save();
    logger.warn("Stopped because MAX_LOOP_ITERATIONS was reached");
  }

  private async handleDashboardPopup(page: Page): Promise<boolean> {
    logger.info("Found a popup dialog. Attempting to close it.");
    // Matches common close interactions: X buttons, 'Close' text, or 'Got it'
    const closeBtn = page
      .locator(
        ".p-dialog-header-close, button:has-text('Close'), button[aria-label='Close'], button:has-text('Got it'), button:has-text('I agree'), button:has-text('Ok')",
      )
      .first();
    if (await isVisible(closeBtn)) {
      await closeBtn.click();
      logger.info("Closed popup.");
      return true;
    }
    return false;
  }

  private async handleQuizIntro(page: Page): Promise<boolean> {
    logger.info("Quiz intro detected. Attempting to start.");
    const clicked = await clickAction(page, [selectors.quizStartText]);
    if (clicked) {
      await page.waitForTimeout(1500);
      return true;
    }
    return false;
  }

  private async handleDocument(page: Page): Promise<boolean> {
    logger.info(
      "Document-style page detected. Looking for 'Show all pages' checkbox.",
    );
    const clicked = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll("label"));
      const label = labels.find((l) =>
        /show all pages/i.test(l.textContent || ""),
      );
      if (label && label.htmlFor) {
        const cb = document.getElementById(
          label.htmlFor,
        ) as HTMLInputElement | null;
        if (cb && !cb.checked) {
          cb.click();
          return true;
        }
      }
      return false;
    });

    if (clicked) {
      logger.info("Clicked 'Show all pages' checkbox");
      await page.waitForTimeout(500);
    }
    return false; // Let tryMoveToNext click the next button
  }

  private async isAssignmentStep(page: Page): Promise<boolean> {
    const fileInputs = await page.locator("input[type='file']").count();
    if (fileInputs > 0) {
      return true;
    }

    const mainText = await page.evaluate(() => {
      // Avoid scanning the sidebar tree for generic keywords
      const content = document.querySelector(
        ".content-viewer, .main-content, main, #main-wrapper",
      );
      return (content?.textContent ?? document.body?.innerText ?? "")
        .toLowerCase()
        .replace(/\s+/g, " ");
    });

    // Make keywords more strict since 'assignment' appears in sidebar titles and could leak if selector fails
    const strictKeywords = ["upload your", "attach file", "submit project"];
    return strictKeywords.some((keyword) => mainText.includes(keyword));
  }

  private async waitForEnter(): Promise<void> {
    await new Promise<void>((resolve) => {
      process.stdin.resume();
      process.stdin.once("data", () => {
        process.stdin.pause();
        resolve();
      });
    });
  }
}
