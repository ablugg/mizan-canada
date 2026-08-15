import http from "http";
import net from "net";
import path from "path";
import fs from "fs";
import { app, utilityProcess, UtilityProcess } from "electron";

let serverProcess: UtilityProcess | null = null;

function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      server.close(() => resolve(addr.port));
    });
    server.on("error", reject);
  });
}

function waitForHttp(port: number, timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function tryRequest() {
      const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
        res.resume();
        resolve();
      });
      req.setTimeout(1000);
      req.on("error", () => {
        if (Date.now() >= deadline) {
          reject(new Error("Next.js server did not start in time"));
        } else {
          setTimeout(tryRequest, 500);
        }
      });
      req.on("timeout", () => {
        req.destroy();
        if (Date.now() >= deadline) {
          reject(new Error("Next.js server did not start in time"));
        } else {
          setTimeout(tryRequest, 500);
        }
      });
    }

    tryRequest();
  });
}

function loadEnvFile(): Record<string, string> {
  const envPath = app.isPackaged
    ? path.join(process.resourcesPath, ".env")
    : path.join(app.getAppPath(), ".env");
  if (!fs.existsSync(envPath)) return {};
  const result: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf("=");
    if (idx === -1) continue;
    const key = t.slice(0, idx).trim();
    const val = t.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    result[key] = val;
  }
  return result;
}

function ensureDatabase(userData: string): void {
  const dbPath = path.join(userData, "mizan.db");
  if (fs.existsSync(dbPath)) return;

  // On first launch copy the bundled seed database (has schema, no user data)
  const seedPath = path.join(process.resourcesPath, "seed.db");
  if (fs.existsSync(seedPath)) {
    fs.mkdirSync(userData, { recursive: true });
    fs.copyFileSync(seedPath, dbPath);
    console.log("[db] Database initialised from seed.");
  } else {
    console.error("[db] seed.db not found — database will be missing");
  }
}

export async function startNextServer(): Promise<number> {
  if (process.env.NODE_ENV === "development") {
    return 3100;
  }

  const port = await getAvailablePort();
  const serverScript = path.join(app.getAppPath(), ".next/standalone/server.js");
  const userData = app.getPath("userData");

  // Ensure database exists on first launch
  ensureDatabase(userData);

  const envFileVars = loadEnvFile();

  serverProcess = utilityProcess.fork(serverScript, [], {
    env: {
      ...envFileVars,
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      DATABASE_URL: `file:${path.join(userData, "mizan.db")}`,
      VECTOR_DB_PATH: path.join(process.resourcesPath, "vector-store"),
      OLLAMA_HOST: "http://127.0.0.1:11434",
    },
    stdio: "pipe",
  });

  serverProcess.stdout?.on("data", (d: Buffer) => console.log("[next]", d.toString().trim()));
  serverProcess.stderr?.on("data", (d: Buffer) => console.error("[next]", d.toString().trim()));
  serverProcess.on("exit", (code) => console.error(`[next] Process exited with code ${code}`));

  await waitForHttp(port);
  console.log(`[next] Server ready on port ${port}`);
  return port;
}

export async function stopNextServer(): Promise<void> {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

