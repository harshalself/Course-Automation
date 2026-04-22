import { Locator, Page } from "playwright";

import { logger } from "../logger";
import { selectors } from "../selectors";

const NEXT_POLL_TIMEOUT_MS = 15000;
const NEXT_POLL_INTERVAL_MS = 1000;
const AFTER_NEXT_CLICK_WAIT_MS = 1500;

async function hasAny(locator: Locator): Promise<boolean> {
  const count = await locator.count();
  return count > 0;
}

export async function isVisible(locator: Locator): Promise<boolean> {
  if (!(await hasAny(locator))) {
    return false;
  }
  return await locator.isVisible().catch(() => false);
}

async function isClickable(locator: Locator): Promise<boolean> {
  if (!(await isVisible(locator))) {
    return false;
  }
  return await locator.isEnabled().catch(() => false);
}

export async function firstVisible(
  page: Page,
  candidates: string[],
): Promise<Locator | null> {
  for (const selector of candidates) {
    const locator = page.locator(selector).first();
    if (await isVisible(locator)) {
      return locator;
    }
  }

  return null;
}

export async function clickAction(
  page: Page,
  names: RegExp[],
): Promise<boolean> {
  for (const name of names) {
    const button = page.getByRole("button", { name }).first();
    if (await isClickable(button)) {
      try {
        await button.click();
        return true;
      } catch (error) {
        logger.warn(
          `Button click failed for pattern ${name}: ${(error as Error).message}`,
        );

        await dismissBlockingDialog(page);

        try {
          await button.click({ force: true });
          return true;
        } catch {
          // Continue trying other controls.
        }
      }
    }

    const link = page.getByRole("link", { name }).first();
    if (await isClickable(link)) {
      try {
        await link.click();
        return true;
      } catch (error) {
        logger.warn(
          `Link click failed for pattern ${name}: ${(error as Error).message}`,
        );

        await dismissBlockingDialog(page);

        try {
          await link.click({ force: true });
          return true;
        } catch {
          // Continue trying other controls.
        }
      }
    }
  }

  return false;
}

export async function tryMoveToNext(page: Page): Promise<boolean> {
  const startedAt = Date.now();
  const nextBtn = page.locator(selectors.footerNextButton).first();

  while (Date.now() - startedAt < NEXT_POLL_TIMEOUT_MS) {
    if (await isVisible(nextBtn)) {
      const isDisabled = await nextBtn.isDisabled();
      const rawClass = await nextBtn.getAttribute("class");
      if (!isDisabled && !rawClass?.includes("disabled-button")) {
        logger.info("Clicking footer Next button explicitly.");
        try {
          await nextBtn.click();
          await page.waitForTimeout(AFTER_NEXT_CLICK_WAIT_MS);
          return true;
        } catch (error) {
          logger.warn(`Footer Next click failed: ${(error as Error).message}`);

          await dismissBlockingDialog(page);

          try {
            await nextBtn.click({ force: true });
            await page.waitForTimeout(AFTER_NEXT_CLICK_WAIT_MS);
            return true;
          } catch {
            // Fall through and keep polling.
          }
        }
      }
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      logger.info(`Next button still locked. Polling... (${elapsed}s)`);
    } else {
      // Footer button not visible, try link/button fallback immediately.
      break;
    }

    await page.waitForTimeout(NEXT_POLL_INTERVAL_MS);
  }

  if (await isVisible(nextBtn)) {
    logger.info("Next button still locked after polling. Reporting blocked.");
    return false;
  }

  const clicked = await clickAction(page, selectors.nextActionNames);
  if (!clicked) {
    return false;
  }

  await page.waitForTimeout(AFTER_NEXT_CLICK_WAIT_MS);
  return true;
}

async function dismissBlockingDialog(page: Page): Promise<boolean> {
  const dialogButtons = [
    /try\s*again/i,
    /ok/i,
    /close/i,
    /cancel/i,
    /yes/i,
    /no/i,
  ];

  for (const pattern of dialogButtons) {
    const button = page
      .locator(
        ".p-dialog button, .p-confirm-dialog button, [role='dialog'] button",
      )
      .filter({ hasText: pattern })
      .first();

    if (await isClickable(button)) {
      logger.info(`Dismissing blocking dialog with button ${pattern}.`);
      await button.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(300);
      return true;
    }
  }

  return false;
}
