import { Page } from "playwright";

import { logger } from "../logger";
import { isVisible } from "./dom-actions";

export async function handleContentViewerInit(
  page: Page,
  forceTraversal = false,
): Promise<boolean> {
  logger.info("In Content Viewer. Waiting for lazy-loaded modules...");
  await page.waitForTimeout(4000);

  // Quick re-check to ensure we are not interrupting a slow-loading video/quiz.
  // Skip this check if forceTraversal is set (called as a stuck-Next fallback).
  if (!forceTraversal) {
    const isVideo = (await page.locator("video").count()) > 0;
    const isQuiz =
      (await page
        .locator("input[type='radio'], input[type='checkbox'], textarea")
        .count()) > 0;
    if (isVideo || isQuiz) {
      logger.info("Late content detected! Escaping init state.");
      return true;
    }
  } else {
    logger.info(
      "Force traversal mode: skipping late content check, scanning tree for next node.",
    );
  }

  logger.info("No content surfaced. Navigating via tree traversal.");

  const isSidebarOpen = await page.evaluate(() => {
    const sidebar = document.querySelector("#tree-viewer, .sidebar");
    return Boolean(sidebar && sidebar.clientWidth > 0);
  });

  if (!isSidebarOpen) {
    const toggleBtn = page
      .locator("button.header-sidebar-toggle-button")
      .first();
    if (await isVisible(toggleBtn)) {
      logger.info("Opening sidebar tree...");
      await toggleBtn.click();
      await page.waitForTimeout(1000);
    }
  }

  const targetIndex = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll(".p-treenode-content"));
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (!node) {
        continue;
      }

      const cls = node.className || "";
      const hasToggler = node.querySelector(".p-tree-toggler");

      if (
        cls.includes("p-treenode-selectable") &&
        !cls.includes("completed") &&
        !cls.includes("session-completed")
      ) {
        // Avoid blindly clicking parent folders if they have togglers.
        if (
          !hasToggler ||
          window.getComputedStyle(hasToggler).visibility !== "visible"
        ) {
          return i;
        }
      }
    }
    return -1;
  });

  if (targetIndex >= 0) {
    logger.info(
      `Navigating to incomplete leaf item at index ${targetIndex} via Playwright native click.`,
    );
    const item = page.locator(".p-treenode-content").nth(targetIndex);
    await item.click({ force: true });
    await page.waitForTimeout(3000);
    return true;
  }

  logger.warn(
    "Could not find any remaining incomplete leaf items in the tree.",
  );
  return false;
}
