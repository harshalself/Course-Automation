# LMS Sequential Automation (Playwright + TypeScript)

This project automates a sequential LMS flow with these goals:

- Move session-by-session in order.
- Handle videos.
- Handle quizzes via configurable mode.
- Stop when an assignment/upload page is reached.
- Save runtime state for resumable execution.

## Features

- Headed browser by default.
- Auto login from environment credentials, with manual login fallback.
- Quiz modes:
  - `manual`: detect quiz and solve using sequential brute-force cycling.
- Optional `AUTO_SUBMIT_QUIZ=true`.
- For this ERA flow, set `VIDEO_SCRIPT_FILE=scripts/video-complete.js`.
- Runtime state file at `runtime/state.json`.

## Setup

1. Install dependencies:

```bash
npm install
npx playwright install chromium
```

2. Create environment file:

```bash
cp .env.example .env
```

3. Fill `.env` values.

## Run

```bash
npm run start
```

## Main Configuration

- `LMS_BASE_URL`: login page URL.
- `LMS_USERNAME`, `LMS_PASSWORD`: optional credentials.
- `HEADLESS`: `true` or `false`.
- `QUIZ_MODE`: `manual`.
- `AUTO_SUBMIT_QUIZ`: `true` or `false`.
- `STOP_ON_ASSIGNMENT`: `true` or `false`.
- `VIDEO_SCRIPT_FILE`: JS file path injected on video pages. Use `scripts/video-complete.js` for this course flow.
- `MAX_LOOP_ITERATIONS`: max navigation steps per run.

Example:

- `VIDEO_SCRIPT_FILE=scripts/video-complete.js`

## Notes

- Selector patterns are heuristic and may require refinement after first live run.
- Keep `.env` out of version control.
- The bot intentionally stops when assignment/upload step is detected.
