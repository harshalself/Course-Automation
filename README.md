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
LLM_API_KEY=your_provider_api_key
```

**Behavioral Config (`config.json`):**
Adjust the automation behavior in `config.json`.

| Field | Description | Default |
| :--- | :--- | :--- |
| `headless` | Run without a visible browser window | `false` |
| `quizMode` | `manual` for legacy probing or `llm` for model-based answering | `manual` |
| `llmProvider` | `openrouter`, `ollama`, or `lmstudio` | `openrouter` |
| `llmModel` | Provider model id, e.g. `cohere/command-a`, `openai/gpt-5.2`, `anthropic/claude-sonnet-4.6`, `google/gemini-2.5-flash`, `llama3.2`, or your LM Studio model identifier | `cohere/command-a` |
| `llmApiKey` | API key for OpenRouter or another OpenAI-compatible provider. Prefer `.env` `LLM_API_KEY` for secrets | provider default |
| `llmBaseUrl` | OpenAI-compatible base URL. Use `http://localhost:11434/v1` for Ollama or `http://localhost:1234/v1` for LM Studio | provider default |
| `llmStructuredOutputMode` | `json_schema` for strict schema output or `json_object` for JSON mode. Ollama defaults to `json_object`; OpenRouter and LM Studio default to `json_schema` | provider default |
| `llmTemperature` | Model sampling temperature for quiz answers | `0` |
| `llmTimeoutMs` | LLM request timeout in milliseconds | `45000` |
| `llmMaxAnswerAttempts` | Maximum LLM attempts per question when the page reports a wrong answer. Wrong answers are fed back to the model before retrying | `2` |
| `autoSubmitQuiz` | Automatically submit quiz once answers found | `true` |
| `stopOnAssignment` | Stop when a file upload step is reached | `true` |
| `notifyOnStop` | Play a sound on completion/error | `true` |
| `maxLoopIterations` | Maximum number of navigation steps per run | `100` |

---

## Core Features

- **Quiz Solving Engine**: Automatically detects quizzes and can either use the legacy manual probing mode or ask OpenRouter, Ollama, or LM Studio to choose answers.
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

### Local LLM Providers

Cloud providers use `LLM_API_KEY`. Local providers use OpenAI-compatible HTTP APIs, so no real cloud API key is required.

For OpenRouter, set:

```env
LLM_API_KEY=your_openrouter_api_key
```

Then use:

```json
{
  "quizMode": "llm",
  "llmProvider": "openrouter",
  "llmModel": "cohere/command-a",
  "llmBaseUrl": "https://openrouter.ai/api/v1",
  "llmStructuredOutputMode": "json_schema",
  "llmTemperature": 0
}
```

#### Ollama

Install and start Ollama, then pull the model you want to use:

```bash
ollama pull llama3.2
```

Ollama serves its OpenAI-compatible API at `http://localhost:11434/v1` by default. Set `config.json` like this:

```json
{
  "quizMode": "llm",
  "llmProvider": "ollama",
  "llmModel": "llama3.2",
  "llmBaseUrl": "http://localhost:11434/v1",
  "llmStructuredOutputMode": "json_object",
  "llmTemperature": 0
}
```

Use `json_object` for Ollama because its OpenAI-compatible API supports JSON mode broadly. The app still validates the returned JSON with Zod before using it.

#### LM Studio

In LM Studio:

1. Download and load a chat/instruct model.
2. Open the **Developer** tab.
3. Start the local server.
4. Copy the loaded model identifier and use it as `llmModel`.

The default LM Studio OpenAI-compatible URL is `http://localhost:1234/v1`. Set `config.json` like this:

```json
{
  "quizMode": "llm",
  "llmProvider": "lmstudio",
  "llmModel": "your-loaded-model-identifier",
  "llmBaseUrl": "http://localhost:1234/v1",
  "llmStructuredOutputMode": "json_schema",
  "llmTemperature": 0
}
```

You can also start the LM Studio server from the CLI:

```bash
lms server start
```

LM Studio supports JSON Schema structured output on its OpenAI-compatible chat endpoint, so `json_schema` is the recommended mode.

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
