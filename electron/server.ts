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

async function ensureVectorStore(): Promise<string> {
  // Check if bundled vector store has data
  const bundledPath = path.join(process.resourcesPath, "vector-store");
  const bundledTable = path.join(bundledPath, "legal_chunks.lance");
  if (fs.existsSync(bundledTable)) {
    console.log("[vectors] Using bundled vector store.");
    return bundledPath;
  }

  // Fall back to userData location (downloaded on first launch)
  const userPath = path.join(app.getPath("userData"), "vector-store");
  const userTable = path.join(userPath, "legal_chunks.lance");
  if (fs.existsSync(userTable)) {
    console.log("[vectors] Using downloaded vector store.");
    return userPath;
  }

  // Download from GitHub
  console.log("[vectors] Vector store not found. Downloading...");
  try {
    const https = await import("https");
    const url = "https://github.com/ablugg/mizan-canada/releases/download/data-v1/vector-store.zip";
    const zipPath = path.join(app.getPath("temp"), "vector-store.zip");

    await new Promise<void>((resolve, reject) => {
      function download(downloadUrl: string) {
        https.get(downloadUrl, (res) => {
          if (res.statusCode === 302 || res.statusCode === 301) {
            download(res.headers.location!);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed: ${res.statusCode}`));
            return;
          }
          const file = fs.createWriteStream(zipPath);
          res.pipe(file);
          file.on("finish", () => { file.close(); resolve(); });
          file.on("error", reject);
        }).on("error", reject);
      }
      download(url);
    });

    // Extract zip
    console.log("[vectors] Extracting...");
    const { execSync } = await import("child_process");
    fs.mkdirSync(userPath, { recursive: true });
    if (process.platform === "win32") {
      execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${app.getPath("userData")}' -Force"`, { timeout: 300000 });
    } else {
      execSync(`unzip -qo "${zipPath}" -d "${app.getPath("userData")}"`, { timeout: 300000 });
    }

    // Clean up zip
    try { fs.unlinkSync(zipPath); } catch {}

    // The zip extracts to data/vector-store/, move it up
    const extractedPath = path.join(app.getPath("userData"), "data", "vector-store");
    if (fs.existsSync(extractedPath) && !fs.existsSync(userTable)) {
      fs.renameSync(extractedPath, userPath);
      try { fs.rmdirSync(path.join(app.getPath("userData"), "data")); } catch {}
    }

    console.log("[vectors] Vector store downloaded and extracted.");
    return userPath;
  } catch (err) {
    console.error("[vectors] Download failed:", err);
    // Return bundled path even if empty; app will work without RAG
    return bundledPath;
  }
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

  // Resolve vector store (bundled or downloaded)
  const vectorDbPath = await ensureVectorStore();

  const envFileVars = loadEnvFile();

  // Ensure BRIDGE_SECRET is always set so session encryption is consistent
  const bridgeSecret =
    envFileVars.BRIDGE_SECRET || process.env.BRIDGE_SECRET || "dev-fallback-insecure";

  serverProcess = utilityProcess.fork(serverScript, [], {
    env: {
      ...envFileVars,
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      DATABASE_URL: `file:${path.join(userData, "mizan.db")}`,
      VECTOR_DB_PATH: vectorDbPath,
      OLLAMA_HOST: "http://127.0.0.1:11434",
      BRIDGE_SECRET: bridgeSecret,
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

