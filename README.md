# Course Automation Everywhere

An advanced, resilient automation suite built with Playwright and TypeScript, designed to navigate and complete online learning modules autonomously.

**Developed by [Harshal Patil](https://github.com/harshalself)**

---

## Setup

Setting up Course Automation Everywhere is fast and straightforward.

### 1. Installation

Clone the repository and install dependencies. The browser binaries will be installed automatically.

```bash
npm install
```

### 2. Configuration

**Environment Variables (`.env`):**
Create a `.env` file based on `.env.example` and add your account credentials.

```env
COURSE_USER=your_username
COURSE_PASS=your_password
```

**Behavioral Config (`config.json`):**
Adjust the automation behavior in `config.json`.

| Field | Description | Default |
| :--- | :--- | :--- |
| `headless` | Run without a visible browser window | `false` |
| `quizMode` | `manual` (brute-force) or specified mode | `manual` |
| `autoSubmitQuiz` | Automatically submit quiz once answers found | `true` |
| `stopOnAssignment` | Stop when a file upload step is reached | `true` |
| `notifyOnStop` | Play a sound on completion/error | `true` |
| `maxLoopIterations` | Maximum number of navigation steps per run | `100` |

---

## Core Features

- **Quiz Solving Engine**: Automatically detects quizzes and uses a brute-force cycling algorithm to find correct answers.
- **Video Completion**: Injects custom scripts into video players to trigger "completion" events immediately.
- **Audio Alerts**: Plays a notification sound (`afplay` on macOS) when the automation finishes or requires intervention.
- **Resumable Execution**: Saves progress in `runtime/state.json` to pick up exactly where it left off.
- **Structural Awareness**: Recognizes documents, dashboards, and popups, navigating with human-like delays.
- **Smart Stopping**: Halts when it detects an assignment or project upload page to prevent accidental submissions.

---

## Running the Automation

Once configured, simply run:

```bash
npm run start
```

---

## Contributing

This project is open for contributions! Whether it's fixing bugs, adding new selectors, or improving the engine, your help is welcome.

### How to contribute:
1. Fork the repository.
2. Create a new feature branch (`git checkout -b feature/amazing-feature`).
3. Commit your changes (`git commit -m 'Add some amazing feature'`).
4. Push to the branch (`git push origin feature/amazing-feature`).
5. Open a Pull Request.

---

## Troubleshooting & Logs

- **Logs**: Execution logs are stored in the `logs/` directory. Check `info.log` for progress and `error.log` for debugging.
- **State**: To reset memory, delete `runtime/state.json`.
- **Manual Login**: If auto-login fails, log in manually in the browser window and press **Enter** in the terminal.

---

## Disclaimer

This tool is for educational purposes. Ensure you comply with the terms of service of your learning platform.

---

*Built for rapid learning productivity.*
