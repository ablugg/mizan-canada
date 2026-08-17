import { spawn, ChildProcess } from "child_process";
import path from "path";
import { app } from "electron";

const OLLAMA_HOST = "http://127.0.0.1:11434";

export class OllamaManager {
  private static instance: OllamaManager;
  private process: ChildProcess | null = null;

  static getInstance(): OllamaManager {
    if (!OllamaManager.instance) {
      OllamaManager.instance = new OllamaManager();
    }
    return OllamaManager.instance;
  }

  private getBinaryPath(): string {
    if (process.env.NODE_ENV === "development") {
      return process.platform === "win32" ? "ollama.exe" : "ollama";
    }

    if (process.platform === "win32") {
      return path.join(process.resourcesPath, "ollama", "win", "ollama.exe");
    }

    return path.join(process.resourcesPath, "ollama", "mac", "ollama");
  }

  async isRunning(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: controller.signal });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  async start(): Promise<void> {
    if (await this.isRunning()) {
      console.log("[ollama] Already running");
      return;
    }

    const binaryPath = this.getBinaryPath();
    console.log("[ollama] Starting from:", binaryPath);

    const modelsDir = path.join(app.getPath("userData"), "models");

    this.process = spawn(binaryPath, ["serve"], {
      env: {
        ...process.env,
        OLLAMA_MODELS: modelsDir,
        OLLAMA_HOST: "127.0.0.1:11434",
        OLLAMA_KEEP_ALIVE: "-1", // keep model in GPU memory indefinitely
        OLLAMA_NUM_PARALLEL: "2", // allow parallel requests (suggestions + chat)
      },
      stdio: "ignore",
      detached: false,
    });

    this.process.on("error", (err) => {
      console.error("[ollama] Process error:", err);
    });

    // Wait up to 20s for Ollama to become available
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (await this.isRunning()) {
        console.log("[ollama] Ready");
        return;
      }
    }

    throw new Error("Ollama failed to start within 20 seconds");
  }

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
      console.log("[ollama] Stopped");
    }
  }

  async modelExists(model: string): Promise<boolean> {
    try {
      const res = await fetch(`${OLLAMA_HOST}/api/tags`);
      const data = (await res.json()) as { models: Array<{ name: string }> };
      const modelBase = model.split(":")[0];
      return data.models.some(
        (m) => m.name === model || m.name.startsWith(modelBase + ":")
      );
    } catch {
      return false;
    }
  }

  async *pullModel(
    model: string
  ): AsyncGenerator<{ status: string; total?: number; completed?: number }> {
    const res = await fetch(`${OLLAMA_HOST}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model, stream: true }),
    });

    if (!res.body) throw new Error("No response body from Ollama pull");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value, { stream: true }).split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          yield JSON.parse(line);
        } catch {
          // skip malformed lines
        }
      }
    }
  }
}
