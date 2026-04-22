import { Page } from "playwright";

import { logger } from "../logger";
import { selectors } from "../selectors";
import { RuntimeStateStore } from "../state-store";
import { isVisible } from "./dom-actions";

export async function handleVideo(
  page: Page,
  currentUrl: string,
  state: RuntimeStateStore,
  videoScript: string | null,
): Promise<boolean> {
  const videoCount = await page.locator("video").count();
  if (videoCount === 0) {
    return false;
  }

  const title = await page.evaluate(() => {
    // Primary: use video src, which is guaranteed unique per video file.
    const video = document.querySelector("video") as HTMLVideoElement | null;
    const src = video?.currentSrc || video?.src || "";
    if (src) {
      const srcFile = src.split("?")[0]?.split("/").pop() || "";
      if (srcFile) {
        return srcFile;
      }
    }

    const heading = document.querySelector(
      ".content-title, .module-title, .lesson-title, [class*='lesson'][class*='title']",
    );
    if (heading && heading.textContent?.trim()) {
      return heading.textContent.trim().slice(0, 80);
    }

    const activeNode = document.querySelector(
      '.p-treenode-content[aria-selected="true"], .p-highlight, .active-node',
    );
    return activeNode ? activeNode.textContent?.trim().slice(0, 80) || "" : "";
  });

  const stateKey = `${currentUrl}-${title || Date.now()}`;
  logger.info(`Video stateKey resolved: "${title}"`);

  if (state.hasVideoCompleted(stateKey)) {
    const nextBtn = page.locator(selectors.footerNextButton).first();
    const isLocked =
      (await isVisible(nextBtn)) &&
      ((await nextBtn.isDisabled()) ||
        ((await nextBtn.getAttribute("class")) || "").includes(
          "disabled-button",
        ));

    if (!isLocked) {
      logger.info(
        `Video "${title}" already handled, Next is unlocked - deferring to default flow`,
      );
      return false;
    }

    logger.warn(
      `Video "${title}" already handled but Next is LOCKED. Re-running skip script to force LMS registration...`,
    );
    if (videoScript) {
      await page.evaluate((scriptText) => {
        new Function(scriptText)();
      }, videoScript);
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
    return false;
  }

  logger.info(`Video "${title}" detected, attempting completion flow`);

  if (videoScript) {
    await page.evaluate((scriptText) => {
      new Function(scriptText)();
    }, videoScript);

    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const video = document.querySelector("video") as HTMLVideoElement | null;
      if (video) {
        video.dispatchEvent(new Event("timeupdate", { bubbles: true }));
        video.dispatchEvent(new Event("ended", { bubbles: true }));
      }
    });
    logger.info(
      "Video skip script run. Waiting for LMS backend to acknowledge...",
    );
    await page.waitForTimeout(3000);
  } else {
    await page.evaluate(() => {
      const video = document.querySelector("video") as HTMLVideoElement | null;
      if (!video) {
        return;
      }

      video.muted = true;
      video.playbackRate = 16;
      void video.play().catch(() => undefined);
    });

    await waitForVideoToEnd(page);
    await page.waitForTimeout(1500);
  }

  state.markVideoCompleted(stateKey);
  await state.save();

  return false;
}

async function waitForVideoToEnd(page: Page): Promise<void> {
  const startedAt = Date.now();
  const timeoutMs = 120000;

  while (Date.now() - startedAt < timeoutMs) {
    const ended = await page.evaluate(() => {
      const video = document.querySelector("video") as HTMLVideoElement | null;
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
