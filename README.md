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
OPENROUTER_API_KEY=your_openrouter_api_key
```

**Behavioral Config (`config.json`):**
Adjust the automation behavior in `config.json`.

| Field | Description | Default |
| :--- | :--- | :--- |
| `headless` | Run without a visible browser window | `false` |
| `quizMode` | `manual` for legacy probing or `llm` for OpenRouter-based answering | `manual` |
| `openRouterModel` | OpenRouter model id, e.g. `openai/gpt-5.2`, `anthropic/claude-sonnet-4.6`, `google/gemini-2.5-flash`, `cohere/command-a` | `google/gemini-2.5-flash` |
| `openRouterTemperature` | Model sampling temperature for quiz answers | `0` |
| `openRouterTimeoutMs` | LLM request timeout in milliseconds | `45000` |
| `autoSubmitQuiz` | Automatically submit quiz once answers found | `true` |
| `stopOnAssignment` | Stop when a file upload step is reached | `true` |
| `notifyOnStop` | Play a sound on completion/error | `true` |
| `maxLoopIterations` | Maximum number of navigation steps per run | `100` |

---

## Core Features

- **Quiz Solving Engine**: Automatically detects quizzes and can either use the legacy manual probing mode or ask an OpenRouter LLM to choose answers.
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

> This project is strictly for **development and automation learning purposes**. It is intended to showcase technical capabilities in browser automation and system resilience.
>
> The author does **not** promote, encourage, or support cheating, academic dishonesty, or any practices that violate the Terms of Service of any educational platform. Users are solely responsible for their actions and should ensure they are using this tool in compliance with all relevant policies and legal requirements.


---

*Built for rapid learning productivity.*
