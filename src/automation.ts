import fs from "node:fs/promises";
import path from "node:path";

import { Browser, chromium, Locator, Page } from "playwright";

import { AnswerKeyStore } from "./answer-key";
import { config } from "./config";
import { logger } from "./logger";
import { selectors } from "./selectors";
import { RuntimeStateStore } from "./state-store";
import { normalizeText } from "./text";
import { QuizMode, QuizSnapshot, QuizSuggestion } from "./types";

type PageType = "assignment" | "quiz-intro" | "quiz-question" | "document" | "video" | "dashboard-start" | "dashboard-continue" | "dashboard-popup" | "dashboard-loading" | "content-viewer-init" | "unknown";

export class EraAutomation {
  private readonly state = new RuntimeStateStore(config.stateFile);
  private readonly answerKeyStore = new AnswerKeyStore(config.answerKeyFile);
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
    if (config.quizMode === "answer-key") {
      await this.answerKeyStore.load();
    }

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
      let usernameInput = await this.firstVisible(page, selectors.usernameInputs);
      let passwordInput = await this.firstVisible(page, selectors.passwordInputs);

      if (usernameInput && passwordInput) {
        await usernameInput.fill(config.username);
        await passwordInput.fill(config.password);
        const clicked = await this.clickAction(page, [/log in/i, /login/i, /sign in/i, /submit/i]);
        if (clicked) {
          await page.waitForTimeout(2500);
          logger.info("Single-page login submitted using environment credentials");
          return;
        }
      } else if (usernameInput && !passwordInput) {
        await usernameInput.fill(config.username);
        const nextClicked = await this.clickAction(page, [/next/i, /continue/i, /submit/i]);
        if (nextClicked) {
          await page.waitForTimeout(2000);
          passwordInput = await this.firstVisible(page, selectors.passwordInputs);
          if (passwordInput) {
            await passwordInput.fill(config.password);
            const loginClicked = await this.clickAction(page, [/log in/i, /login/i, /sign in/i, /submit/i]);
            if (loginClicked) {
              await page.waitForTimeout(2500);
              logger.info("Two-step login submitted using environment credentials");
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

      const pageType = await this.detectPageType(page);
      logger.info(`Detected page type: ${pageType}`);

      if (pageType === "assignment") {
        this.state.setStopReason("assignment_reached");
        await this.state.save();
        logger.info(
          "Assignment step detected, stopping automation as requested",
        );
        return;
      }

      let handled = false;
      if (pageType === "video") {
        handled = await this.handleVideo(page, currentUrl);
      } else if (pageType === "quiz-intro") {
        handled = await this.handleQuizIntro(page);
      } else if (pageType === "quiz-question") {
        handled = await this.handleQuizQuestion(page, currentUrl, config.quizMode);
      } else if (pageType === "document") {
        handled = await this.handleDocument(page);
      } else if (pageType === "dashboard-popup") {
        handled = await this.handleDashboardPopup(page);
      } else if (pageType === "dashboard-start") {
        const el = page.getByText(/start learning/i, { exact: false }).first();
        if (await this.isVisible(el)) {
           await el.click();
           handled = true;
        }
      } else if (pageType === "dashboard-continue") {
        const el = page.getByText(/continue learning/i, { exact: false }).first();
        if (await this.isVisible(el)) {
           await el.click();
           handled = true;
        }
      } else if (pageType === "content-viewer-init") {
        handled = await this.handleContentViewerInit(page);
      } else if (pageType === "dashboard-loading") {
        logger.info("Intermediate OAuth redirect active. Waiting for resolution.");
        await page.waitForTimeout(3000);
        handled = true;
      }

      if (handled) {
        await page.waitForTimeout(config.loopDelayMs);
        continue;
      }

      const moved = await this.tryMoveToNext(page);
      if (!moved) {
        // Next button locked — LMS may require completing a pending quiz/node first.
        // Attempt tree traversal to find and click the next available item.
        logger.warn("Next button blocked. Attempting tree traversal to find next available node.");
        const treeHandled = await this.handleContentViewerInit(page, true);
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

  private async detectPageType(page: Page): Promise<PageType> {
    if (await this.isAssignmentStep(page)) return "assignment";

    // 1. Overtake popups instantly
    const isDialogVisible = await page.locator(".p-dialog:visible, .modal:visible, .cdk-overlay-pane:visible").count() > 0;
    if (isDialogVisible) return "dashboard-popup";

    // 2. Dashboard routing - use getByText since it could be a span or div
    const hasStartLearning = await page.getByText(/start learning/i, { exact: false }).count() > 0;
    if (hasStartLearning) return "dashboard-start";

    const hasContinueLearning = await page.getByText(/continue learning/i, { exact: false }).count() > 0;
    if (hasContinueLearning) return "dashboard-continue";

    // 3. Content specific matching
    const isQuizIntro = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      // Don't re-trigger on results/score pages after submission
      const isResultsPage = /score|result|your answers|retake|view report/i.test(text);
      if (isResultsPage) return false;
      const actionBtn = Array.from(document.querySelectorAll("button")).find(
        (b) => /^(start|resume)$/i.test((b.textContent || "").trim())
      );
      return text.includes("knowledge check") && !!actionBtn;
    });
    if (isQuizIntro) return "quiz-intro";

    const isQuizQuestion = await page.evaluate(() => {
      const radios = document.querySelectorAll("input[type='radio']").length;
      const checkboxes = document.querySelectorAll("input[type='checkbox']").length;
      const hasTextResponse = document.querySelectorAll("textarea, input[type='text']").length > 0;
      
      const hasActionBtn = Array.from(document.querySelectorAll("button")).some((b) => 
        /save|submit|end exam/i.test(b.textContent || "")
      );
      
      const isContentUrl = window.location.href.includes("contentViewer");
      const hasQuestionMarker = document.querySelector("[class*='question']") !== null;

      // Only classify as quiz if it has quiz inputs AND it is either a known content URL or has explicit quiz buttons/markers
      if ((radios + checkboxes > 0 || hasTextResponse) && (isContentUrl || hasActionBtn || hasQuestionMarker)) {
         return true;
      }
      return false;
    });
    if (isQuizQuestion) return "quiz-question";

    const hasShowAllPagesCb = await page.evaluate(() => {
      const cbs = Array.from(document.querySelectorAll("input[type='checkbox']"));
      const labels = Array.from(document.querySelectorAll("label"));
      return (
        cbs.length > 0 &&
        labels.some((l) => /show all pages/i.test(l.textContent || ""))
      );
    });
    if (hasShowAllPagesCb) return "document";

    const videoCount = await page.locator("video").count();
    if (videoCount > 0) return "video";

    if (page.url().includes("contentViewer")) return "content-viewer-init";
    
    // 4. Loading guards for OAuth/SSO redirects 
    if (page.url().includes("#/login") || page.url().includes("eraclientnx.mkcl.org")) return "dashboard-loading";

    return "unknown";
  }

  private async handleDashboardPopup(page: Page): Promise<boolean> {
    logger.info("Found a popup dialog. Attempting to close it.");
    // Matches common close interactions: X buttons, 'Close' text, or 'Got it'
    const closeBtn = page.locator(".p-dialog-header-close, button:has-text('Close'), button[aria-label='Close'], button:has-text('Got it'), button:has-text('I agree'), button:has-text('Ok')").first();
    if (await this.isVisible(closeBtn)) {
       await closeBtn.click();
       logger.info("Closed popup.");
       return true;
    }
    return false;
  }

  private async handleContentViewerInit(page: Page, forceTraversal = false): Promise<boolean> {
    logger.info("In Content Viewer. Waiting for lazy-loaded modules...");
    await page.waitForTimeout(4000);
    
    // Quick re-check to ensure we aren't interrupting a slow-loading video/quiz
    // Skip this check if forceTraversal is set (called as a stuck-Next fallback)
    if (!forceTraversal) {
      const isVideo = await page.locator("video").count() > 0;
      const isQuiz = await page.locator("input[type='radio'], input[type='checkbox'], textarea").count() > 0;
      if (isVideo || isQuiz) {
         logger.info("Late content detected! Escaping init state.");
         return true; 
      }
    } else {
      logger.info("Force traversal mode: skipping late content check, scanning tree for next node.");
    }

    logger.info("No content surfaced. Navigating via tree traversal.");

    const isSidebarOpen = await page.evaluate(() => {
        const sidebar = document.querySelector('#tree-viewer, .sidebar');
        return sidebar && sidebar.clientWidth > 0;
    });

    if (!isSidebarOpen) {
       const toggleBtn = page.locator("button.header-sidebar-toggle-button").first();
       if (await this.isVisible(toggleBtn)) {
           logger.info("Opening sidebar tree...");
           await toggleBtn.click();
           await page.waitForTimeout(1000);
       }
    }

    const targetIndex = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('.p-treenode-content'));
        for (let i = 0; i < nodes.length; i++) {
           const cls = nodes[i].className || "";
           const hasToggler = nodes[i].querySelector('.p-tree-toggler');
           
           if (cls.includes('p-treenode-selectable') && !cls.includes('completed') && !cls.includes('session-completed')) {
               // Avoid blindly clicking parent folders if they have togglers
               if (!hasToggler || window.getComputedStyle(hasToggler).visibility !== 'visible') {
                   return i;
               }
           }
        }
        return -1;
    });

    if (targetIndex >= 0) {
        logger.info(`Navigating to incomplete leaf item at index ${targetIndex} via Playwright native click.`);
        const item = page.locator('.p-treenode-content').nth(targetIndex);
        await item.click({ force: true });
        await page.waitForTimeout(3000); 
        return true;
    }
    
    logger.warn("Could not find any remaining incomplete leaf items in the tree.");
    return false;
  }

  private async handleQuizIntro(page: Page): Promise<boolean> {
    logger.info("Quiz intro detected. Attempting to start.");
    const clicked = await this.clickAction(page, [selectors.quizStartText]);
    if (clicked) {
      await page.waitForTimeout(1500);
      return true;
    }
    return false;
  }

  private async handleDocument(page: Page): Promise<boolean> {
    logger.info("Document-style page detected. Looking for 'Show all pages' checkbox.");
    const clicked = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll("label"));
      const label = labels.find((l) => /show all pages/i.test(l.textContent || ""));
      if (label && label.htmlFor) {
        const cb = document.getElementById(label.htmlFor) as HTMLInputElement | null;
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

  private async handleVideo(
    page: Page,
    currentUrl: string,
  ): Promise<boolean> {
    const videoCount = await page.locator("video").count();
    if (videoCount === 0) {
      return false;
    }

    const title = await page.evaluate(() => {
      // Primary: use video src — guaranteed unique per video file
      const video = document.querySelector("video") as HTMLVideoElement | null;
      const src = video?.currentSrc || video?.src || "";
      if (src) {
        // Extract filename from URL (e.g. lesson-3-intro.mp4)
        const srcFile = src.split("?")[0].split("/").pop() || "";
        if (srcFile) return srcFile;
      }
      // Fallback: try content panel heading
      const heading = document.querySelector(
        ".content-title, .module-title, .lesson-title, [class*='lesson'][class*='title']"
      );
      if (heading && heading.textContent?.trim()) {
        return heading.textContent.trim().slice(0, 80);
      }
      // Last fallback: active sidebar node
      const activeNode = document.querySelector(
        '.p-treenode-content[aria-selected="true"], .p-highlight, .active-node'
      );
      return activeNode ? activeNode.textContent?.trim().slice(0, 80) || "" : "";
    });
    // Always unique: combine URL + resolved title. If still empty use timestamp
    const stateKey = `${currentUrl}-${title || Date.now()}`;
    logger.info(`Video stateKey resolved: "${title}"`);

    if (this.state.hasVideoCompleted(stateKey)) {
      // Check if Next is already unlocked - if so, just proceed
      const nextBtn = page.locator(selectors.footerNextButton).first();
      const isLocked = await this.isVisible(nextBtn) && (
        await nextBtn.isDisabled() ||
        (await nextBtn.getAttribute("class") || "").includes("disabled-button")
      );

      if (!isLocked) {
        logger.info(`Video "${title}" already handled, Next is unlocked - deferring to default flow`);
        return false;
      }

      // Next is locked even though we handled this video - LMS didn't register, re-run skip
      logger.warn(`Video "${title}" already handled but Next is LOCKED. Re-running skip script to force LMS registration...`);
      if (this.videoScript) {
        await page.evaluate((scriptText) => { new Function(scriptText)(); }, this.videoScript);
        await page.waitForTimeout(1000);
        await page.evaluate(() => {
          const v = document.querySelector("video") as HTMLVideoElement | null;
          if (v) {
            v.dispatchEvent(new Event("timeupdate", { bubbles: true }));
            v.dispatchEvent(new Event("ended", { bubbles: true }));
          }
        });
        logger.info("Re-ran video skip. Waiting 5s for LMS backend...");
        await page.waitForTimeout(5000);
      }
      return false; // Let tryMoveToNext poll again
    }

    logger.info(`Video "${title}" detected, attempting completion flow`);

    if (this.videoScript) {
      // Run the custom skip script (spoofs duration, sets currentTime to near end)
      await page.evaluate((scriptText) => {
        new Function(scriptText)();
      }, this.videoScript);

      // Wait briefly, then force-fire the 'ended' event so LMS registers completion
      await page.waitForTimeout(1500);
      await page.evaluate(() => {
        const video = document.querySelector("video") as HTMLVideoElement | null;
        if (video) {
          video.dispatchEvent(new Event("timeupdate", { bubbles: true }));
          video.dispatchEvent(new Event("ended", { bubbles: true }));
        }
      });
      // Give LMS backend time to receive the progress/completion ping
      logger.info("Video skip script run. Waiting for LMS backend to acknowledge...");
      await page.waitForTimeout(3000);
    } else {
      await page.evaluate(() => {
        const video = document.querySelector(
          "video",
        ) as HTMLVideoElement | null;
        if (!video) {
          return;
        }

        video.muted = true;
        video.playbackRate = 16;
        void video.play().catch(() => undefined);
      });

      await this.waitForVideoToEnd(page);
      await page.waitForTimeout(1500); // let LMS backend register
    }

    this.state.markVideoCompleted(stateKey);
    await this.state.save();

    return false; // let main loop hit tryMoveToNext
  }

  private async waitForVideoToEnd(page: Page): Promise<void> {
    const startedAt = Date.now();
    const timeoutMs = 120000;

    while (Date.now() - startedAt < timeoutMs) {
      const ended = await page.evaluate(() => {
        const video = document.querySelector(
          "video",
        ) as HTMLVideoElement | null;
        if (!video) {
          return true;
        }

        if (!Number.isFinite(video.duration) || video.duration <= 0) {
          return false;
        }

        return video.ended || video.currentTime >= video.duration - 0.5;
      });

      if (ended) {
        return;
      }

      await page.waitForTimeout(1000);
    }
  }

  private async handleQuizQuestion(
    page: Page,
    _currentUrl: string,
    mode: QuizMode,
  ): Promise<boolean> {
    // Inner loop: keep answering questions until quiz exits or we hit max
    const MAX_QUESTIONS = 60;
    let questionCount = 0;

    while (questionCount < MAX_QUESTIONS) {
      // Check if we're still on a quiz-question page
      const stillQuiz = await page.evaluate(() => {
        const radios = document.querySelectorAll("input[type='radio']").length;
        const checkboxes = document.querySelectorAll("input[type='checkbox']").length;
        return radios + checkboxes > 0;
      });

      if (!stillQuiz) {
        logger.info(`Quiz inner loop exited after ${questionCount} questions - no more inputs found.`);
        break;
      }

      questionCount++;
      const snapshot = await this.extractQuizSnapshot(page);
      if (!snapshot) {
        logger.warn("Could not extract quiz snapshot, stopping inner loop.");
        break;
      }

      logger.info(`[Quiz Q${questionCount}] ${snapshot.question.slice(0, 100)}`);
      const suggestion = await this.getSuggestion(mode, snapshot);

      // ── Sequential Option Cycling: Try A → B → C → D until correct ────────
      // Tries each radio option one at a time. After selecting, waits for LMS
      // feedback. If "Try Again" appears = wrong, click it and try next option.
      // If advance button (Save & Next / Next) or End Exam (no Try Again) = correct.
      let questionResolved = false;
      const radioCount = await page.locator("input[type='radio']").count();
      const checkboxCount = await page.locator("input[type='checkbox']").count();
      const isMulti = checkboxCount > 0 && radioCount === 0;

      logger.info(`[Quiz Q${questionCount}] Trying options sequentially. Total options: ${radioCount || checkboxCount}`);

      const optionCount = radioCount > 0 ? radioCount : checkboxCount;
      const optionSelector = radioCount > 0 ? "input[type='radio']" : "input[type='checkbox']";

      for (let optIdx = 0; optIdx < optionCount; optIdx++) {
        // Select this option
        const option = page.locator(optionSelector).nth(optIdx);
        if (!(await this.isVisible(option))) {
          logger.warn(`[Quiz Q${questionCount}] Option ${optIdx} not visible, skipping...`);
          continue;
        }
        logger.info(`[Quiz Q${questionCount}] Selecting option index ${optIdx}...`);
        await option.click({ force: true });
        await page.waitForTimeout(1500); // Wait for LMS feedback to appear

        // If "Check/Verify" button appears (practice mode), click it
        const checkBtn = page.locator("button").filter({ hasText: /^check$|^verify$/i }).first();
        if (await this.isVisible(checkBtn)) {
          await checkBtn.click({ force: true });
          await page.waitForTimeout(1500);
        }

        // ── Check: did we get it CORRECT? ─────────────────────────────────
        let advanced = false;
        for (const pat of [/save\s*(&|and)?\s*next/i, /^next$/i, /^continue$/i, /^submit$/i]) {
          const btn = page.locator("button").filter({ hasText: pat }).first();
          if (await this.isVisible(btn) && !(await btn.isDisabled())) {
            logger.info(`[Quiz Q${questionCount}] Option ${optIdx} CORRECT! Advancing with: ${pat}`);
            await btn.click({ force: true });
            advanced = true;
            break;
          }
        }
        if (advanced) { questionResolved = true; break; }

        // Check: End Exam visible AND Try Again NOT visible = last question correct
        const tryAgainNow = page.locator("button").filter({ hasText: /try\s*again|retry/i }).first();
        const endExamNow  = page.locator("button").filter({ hasText: /end\s*exam|finish/i }).first();
        const hasTryAgain = await tryAgainNow.isVisible().catch(() => false);
        const hasEndExam  = await endExamNow.isVisible().catch(() => false);

        if (hasEndExam && !hasTryAgain) {
          // Wait 800ms and re-confirm (End Exam is always in sidebar on Take-A-Challenge)
          await page.waitForTimeout(800);
          const retryConfirm = await tryAgainNow.isVisible().catch(() => false);
          if (!retryConfirm) {
            logger.info(`[Quiz Q${questionCount}] Option ${optIdx} CORRECT (last Q confirmed). Clicking End Exam...`);
            await endExamNow.click({ force: true });
            questionResolved = true;
            break;
          }
        }

        // ── WRONG answer: click Try Again and continue to next option ──────
        if (hasTryAgain) {
          if (optIdx < optionCount - 1) {
            logger.info(`[Quiz Q${questionCount}] Option ${optIdx} WRONG. Clicking Try Again → will try option ${optIdx + 1}...`);
          } else {
            logger.warn(`[Quiz Q${questionCount}] Option ${optIdx} WRONG and it was the LAST option. Clicking Try Again anyway...`);
          }
          await tryAgainNow.click({ force: true });
          await page.waitForTimeout(1000); // Wait for quiz to reset
        } else {
          // No feedback at all — plain exam-style (Save & Next was checked above)
          logger.warn(`[Quiz Q${questionCount}] Option ${optIdx}: no feedback buttons visible. Breaking.`);
          break;
        }
      }
      // ── End sequential cycling ─────────────────────────────────────────────

      if (!questionResolved) {
        // Broad accessibility fallback
        const anyBtn = page.getByRole("button", { name: /save|next|submit|continue/i }).first();
        if (await this.isVisible(anyBtn)) {
          await anyBtn.click({ force: true });
          questionResolved = true;
          logger.info(`[Quiz Q${questionCount}] Clicked via getByRole fallback.`);
        }
      }

      if (!questionResolved) {
        logger.warn(`[Quiz Q${questionCount}] No navigation button found after answering. Trying footer Next as last resort.`);
        await this.tryMoveToNext(page);
        await page.waitForTimeout(2000);
        break; // Exit inner loop — this was likely a non-standard quiz screen
      }

      // Wait for LMS to load next question or route to results
      await page.waitForTimeout(2000);
      // ── End unified handling ─────────────────────────────────────────────


      // Check for confirm dialog (End Exam confirmation)
      const yesBtn = page.locator(".p-confirm-dialog button, .p-dialog button").filter({ hasText: /yes|confirm|ok/i }).first();
      if (await this.isVisible(yesBtn)) {
        logger.info("Confirm dialog — clicking Yes.");
        await yesBtn.click();
        await page.waitForTimeout(2000);
        break; // Quiz submitted
      }
    }

    logger.info("Quiz inner loop complete. Clicking footer Next to advance past results page...");
    // The LMS shows a results/score screen after submission — click Next to move on
    await page.waitForTimeout(2000);
    await this.tryMoveToNext(page);
    return true;
  }

  private async getSuggestion(
    mode: QuizMode,
    snapshot: QuizSnapshot,
  ): Promise<QuizSuggestion | null> {
    if (mode === "manual") {
      return null;
    }

    if (mode === "answer-key") {
      return this.answerKeyStore.lookup(snapshot.question);
    }

    return null;
  }

  private resolveOption(candidate: string, options: string[]): string | null {
    const normalizedCandidate = normalizeText(candidate);
    if (!normalizedCandidate) {
      return null;
    }

    const exact = options.find(
      (option) => normalizeText(option) === normalizedCandidate,
    );
    if (exact) {
      return exact;
    }

    const inclusive = options.find((option) => {
      const normalizedOption = normalizeText(option);
      return (
        normalizedOption.includes(normalizedCandidate) ||
        normalizedCandidate.includes(normalizedOption)
      );
    });

    return inclusive ?? null;
  }

  private async selectOption(page: Page, optionText: string): Promise<boolean> {
    const byLabel = page.getByLabel(optionText, { exact: false }).first();
    if (await this.hasAny(byLabel)) {
      await byLabel.click({ force: true });
      return true;
    }

    const label = page.locator("label", { hasText: optionText }).first();
    if (await this.isVisible(label)) {
      await label.click({ force: true });
      return true;
    }

    const textMatch = page.getByText(optionText, { exact: false }).first();
    if (await this.isVisible(textMatch)) {
      await textMatch.click({ force: true });
      return true;
    }

    return false;
  }

  private async tryMoveToNext(page: Page): Promise<boolean> {
    // Poll until the Next button is enabled (LMS needs time to register backend completion)
    const POLL_TIMEOUT_MS = 15000;
    const POLL_INTERVAL_MS = 1000;
    const startedAt = Date.now();

    const nextBtn = page.locator(selectors.footerNextButton).first();

    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      if (await this.isVisible(nextBtn)) {
        const isDisabled = await nextBtn.isDisabled();
        const rawClass = await nextBtn.getAttribute("class");
        if (!isDisabled && !rawClass?.includes("disabled-button")) {
          logger.info("Clicking footer Next button explicitly.");
          await nextBtn.click();
          await page.waitForTimeout(1500);
          return true;
        }
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        logger.info(`Next button still locked. Polling... (${elapsed}s)`);
      } else {
        // Footer button not visible, try link/button fallback immediately
        break;
      }
      await page.waitForTimeout(POLL_INTERVAL_MS);
    }

    if (await this.isVisible(nextBtn)) {
      logger.info("Next button still locked after polling. Reporting blocked.");
      return false;
    }

    // Fallback if footer button not found at all
    const clicked = await this.clickAction(page, selectors.nextActionNames);
    if (!clicked) {
      return false;
    }

    await page.waitForTimeout(1500);
    return true;
  }

  private async clickAction(page: Page, names: RegExp[]): Promise<boolean> {
    for (const name of names) {
      const button = page.getByRole("button", { name }).first();
      if (await this.isClickable(button)) {
        await button.click();
        return true;
      }

      const link = page.getByRole("link", { name }).first();
      if (await this.isClickable(link)) {
        await link.click();
        return true;
      }
    }

    return false;
  }

  private async extractQuizSnapshot(page: Page): Promise<QuizSnapshot | null> {
    if (await this.isAssignmentStep(page)) {
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

  private async isAssignmentStep(page: Page): Promise<boolean> {
    const fileInputs = await page.locator("input[type='file']").count();
    if (fileInputs > 0) {
      return true;
    }

    const mainText = await page.evaluate(() => {
      // Avoid scanning the sidebar tree for generic keywords
      const content = document.querySelector(".content-viewer, .main-content, main, #main-wrapper");
      return (content?.textContent ?? document.body?.innerText ?? "").toLowerCase().replace(/\s+/g, " ");
    });

    // Make keywords more strict since 'assignment' appears in sidebar titles and could leak if selector fails
    const strictKeywords = ["upload your", "attach file", "submit project"];
    return strictKeywords.some((keyword) => mainText.includes(keyword));
  }

  private async firstVisible(
    page: Page,
    candidates: string[],
  ): Promise<Locator | null> {
    for (const selector of candidates) {
      const locator = page.locator(selector).first();
      if (await this.isVisible(locator)) {
        return locator;
      }
    }

    return null;
  }

  private async isVisible(locator: Locator): Promise<boolean> {
    if (!(await this.hasAny(locator))) {
      return false;
    }
    return await locator.isVisible().catch(() => false);
  }

  private async isClickable(locator: Locator): Promise<boolean> {
    if (!(await this.isVisible(locator))) {
      return false;
    }
    return await locator.isEnabled().catch(() => false);
  }

  private async hasAny(locator: Locator): Promise<boolean> {
    const count = await locator.count();
    return count > 0;
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
