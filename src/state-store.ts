import fs from "node:fs/promises";
import path from "node:path";

export interface RuntimeState {
  completedVideoUrls: string[];
  completedQuizUrls: string[];
  lastUrl: string;
  stopReason: string;
  updatedAt: string;
}

const defaultState: RuntimeState = {
  completedVideoUrls: [],
  completedQuizUrls: [],
  lastUrl: "",
  stopReason: "",
  updatedAt: "",
};

export class RuntimeStateStore {
  private state: RuntimeState = { ...defaultState };

  constructor(private readonly stateFile: string) {}

  async load(): Promise<RuntimeState> {
    const resolvedPath = path.resolve(this.stateFile);
    try {
      const raw = await fs.readFile(resolvedPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<RuntimeState>;
      this.state = {
        completedVideoUrls: Array.isArray(parsed.completedVideoUrls)
          ? parsed.completedVideoUrls.filter(
              (url): url is string => typeof url === "string",
            )
          : [],
        completedQuizUrls: Array.isArray(parsed.completedQuizUrls)
          ? parsed.completedQuizUrls.filter(
              (url): url is string => typeof url === "string",
            )
          : [],
        lastUrl: typeof parsed.lastUrl === "string" ? parsed.lastUrl : "",
        stopReason:
          typeof parsed.stopReason === "string" ? parsed.stopReason : "",
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      };
    } catch {
      this.state = { ...defaultState };
    }
    return this.state;
  }

  markVideoCompleted(url: string): void {
    if (!this.state.completedVideoUrls.includes(url)) {
      this.state.completedVideoUrls.push(url);
    }
    this.state.updatedAt = new Date().toISOString();
  }

  markQuizCompleted(url: string): void {
    if (!this.state.completedQuizUrls.includes(url)) {
      this.state.completedQuizUrls.push(url);
    }
    this.state.updatedAt = new Date().toISOString();
  }

  setLastUrl(url: string): void {
    this.state.lastUrl = url;
    this.state.updatedAt = new Date().toISOString();
  }

  setStopReason(reason: string): void {
    this.state.stopReason = reason;
    this.state.updatedAt = new Date().toISOString();
  }

  hasVideoCompleted(url: string): boolean {
    return this.state.completedVideoUrls.includes(url);
  }

  hasQuizCompleted(url: string): boolean {
    return this.state.completedQuizUrls.includes(url);
  }

  snapshot(): RuntimeState {
    return {
      completedVideoUrls: [...this.state.completedVideoUrls],
      completedQuizUrls: [...this.state.completedQuizUrls],
      lastUrl: this.state.lastUrl,
      stopReason: this.state.stopReason,
      updatedAt: this.state.updatedAt,
    };
  }

  async save(): Promise<void> {
    const resolvedPath = path.resolve(this.stateFile);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(
      resolvedPath,
      JSON.stringify(this.state, null, 2),
      "utf8",
    );
  }
}
