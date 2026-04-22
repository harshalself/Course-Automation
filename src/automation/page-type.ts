import { Page } from "playwright";

export type PageType =
  | "assignment"
  | "quiz-intro"
  | "quiz-question"
  | "document"
  | "video"
  | "dashboard-start"
  | "dashboard-continue"
  | "dashboard-popup"
  | "dashboard-loading"
  | "content-viewer-init"
  | "unknown";

type AssignmentDetector = (page: Page) => Promise<boolean>;

export async function detectPageType(
  page: Page,
  isAssignmentStep: AssignmentDetector,
): Promise<PageType> {
  if (await isAssignmentStep(page)) {
    return "assignment";
  }

  // 1. Overtake popups instantly.
  const isDialogVisible =
    (await page
      .locator(".p-dialog:visible, .modal:visible, .cdk-overlay-pane:visible")
      .count()) > 0;
  if (isDialogVisible) {
    return "dashboard-popup";
  }

  // 2. Dashboard routing - use getByText since it could be a span or div.
  const hasStartLearning =
    (await page.getByText(/start learning/i, { exact: false }).count()) > 0;
  if (hasStartLearning) {
    return "dashboard-start";
  }

  const hasContinueLearning =
    (await page.getByText(/continue learning/i, { exact: false }).count()) > 0;
  if (hasContinueLearning) {
    return "dashboard-continue";
  }

  // 3. Content specific matching.
  const isQuizIntro = await page.evaluate(() => {
    const body = document.body;
    if (!body) {
      return false;
    }
    const text = body.innerText.toLowerCase();
    // Do not re-trigger on results/score pages after submission.
    const isResultsPage = /score|result|your answers|retake|view report/i.test(
      text,
    );
    if (isResultsPage) {
      return false;
    }

    const actionBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => /^(start|resume)$/i.test((b.textContent || "").trim()),
    );
    return text.includes("knowledge check") && !!actionBtn;
  });
  if (isQuizIntro) {
    return "quiz-intro";
  }

  const isQuizQuestion = await page.evaluate(() => {
    const radios = document.querySelectorAll("input[type='radio']").length;
    const checkboxes = document.querySelectorAll(
      "input[type='checkbox']",
    ).length;
    const hasTextResponse =
      document.querySelectorAll("textarea, input[type='text']").length > 0;

    const hasActionBtn = Array.from(document.querySelectorAll("button")).some(
      (b) => /save|submit|end exam/i.test(b.textContent || ""),
    );

    const isContentUrl = window.location.href.includes("contentViewer");
    const hasQuestionMarker =
      document.querySelector("[class*='question']") !== null;

    // Only classify as quiz if it has quiz inputs AND either a known
    // content URL or explicit quiz markers/buttons.
    if (
      (radios + checkboxes > 0 || hasTextResponse) &&
      (isContentUrl || hasActionBtn || hasQuestionMarker)
    ) {
      return true;
    }

    return false;
  });
  if (isQuizQuestion) {
    return "quiz-question";
  }

  const hasShowAllPagesCb = await page.evaluate(() => {
    const cbs = Array.from(document.querySelectorAll("input[type='checkbox']"));
    const labels = Array.from(document.querySelectorAll("label"));
    return (
      cbs.length > 0 &&
      labels.some((l) => /show all pages/i.test(l.textContent || ""))
    );
  });
  if (hasShowAllPagesCb) {
    return "document";
  }

  const videoCount = await page.locator("video").count();
  if (videoCount > 0) {
    return "video";
  }

  if (page.url().includes("contentViewer")) {
    return "content-viewer-init";
  }

  // 4. Loading guards for OAuth/SSO redirects.
  if (
    page.url().includes("#/login") ||
    page.url().includes("eraclientnx.mkcl.org")
  ) {
    return "dashboard-loading";
  }

  return "unknown";
}
