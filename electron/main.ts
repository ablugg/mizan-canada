import { app, BrowserWindow, ipcMain, shell, Menu, globalShortcut, utilityProcess } from "electron";
import path from "path";
import { startNextServer, stopNextServer } from "./server";
import { OllamaManager } from "./ollama";

// Remove default Electron menu bar — app is entirely self-contained
Menu.setApplicationMenu(null);

// Set the app name so macOS menu bar and dock show "Mizan"
app.setName("Mizan");

// Enforce single instance — second launch focuses the existing window instead
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;

// Resolve icon: in production resources are next to the app bundle
const iconPath = app.isPackaged
  ? path.join(process.resourcesPath, "icon.png")
  : path.join(__dirname, "../build/icon.png");

function createWindow(port: number) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Mizan Canada",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0a0a0a",
    show: false,
    icon: iconPath,
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // If the page fails to load, retry after a short delay
  mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
    console.error(`[main] Page load failed (${code}: ${desc}), retrying in 1s…`);
    setTimeout(() => mainWindow?.loadURL(`http://127.0.0.1:${port}`), 1000);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  // Start Ollama in the background — it is non-blocking.
  // The UI will show a setup screen if the model isn't ready yet.
  const ollama = OllamaManager.getInstance();
  ollama.start().catch((err) => {
    console.error("[main] Ollama start failed:", err);
  });

  const port = await startNextServer();
  createWindow(port);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(port);
    }
  });

  // Cmd+Option+I / Ctrl+Shift+I opens DevTools for debugging
  globalShortcut.register("CommandOrControl+Alt+I", () => {
    mainWindow?.webContents.toggleDevTools();
  });
});

app.on("window-all-closed", async () => {
  await stopNextServer();
  OllamaManager.getInstance().stop();
  if (process.platform !== "darwin") app.quit();
});

// --- IPC: Ollama model management ---

ipcMain.handle("ollama:model-exists", async (_, model: string) => {
  return OllamaManager.getInstance().modelExists(model);
});

// Streams pull progress back as events on the sender webContents
ipcMain.handle("ollama:pull-model", async (event, model: string) => {
  try {
    for await (const progress of OllamaManager.getInstance().pullModel(model)) {
      if (!event.sender.isDestroyed()) {
        event.sender.send("ollama:pull-progress", progress);
      }
    }
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

// --- IPC: App info ---

ipcMain.handle("app:version", () => app.getVersion());
ipcMain.handle("app:userData", () => app.getPath("userData"));

// --- IPC: Hardware detection ---

ipcMain.handle("app:hardware", async () => {
  const os = await import("os");
  const totalRam = os.totalmem();
  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model : "Unknown";
  const cpuCores = cpus.length;
  const platform = os.platform();
  const arch = os.arch();
  return { totalRam, cpuModel, cpuCores, platform, arch };
});

// --- IPC: Update check ---

ipcMain.handle("app:checkUpdate", async () => {
  try {
    const res = await fetch(
      "https://api.github.com/repos/ablugg/mizan-canada/releases/latest",
      { headers: { "User-Agent": "Mizan-Canada" }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return { hasUpdate: false };
    const data = await res.json() as { tag_name?: string; assets?: Array<{ name: string; browser_download_url: string }> };
    const latest = (data.tag_name ?? "").replace(/^v/, "");
    const current = app.getVersion();
    const hasUpdate = latest !== "" && latest !== current;

    // Find the right asset for this platform + arch
    let downloadUrl = "";
    if (hasUpdate && data.assets) {
      const plat = process.platform;
      const arch = process.arch;
      if (plat === "darwin") {
        const suffix = arch === "arm64" ? "-arm64.dmg" : ".dmg";
        const asset = data.assets.find(a => a.name.endsWith(suffix) && (arch !== "arm64" || a.name.includes("arm64")))
          ?? data.assets.find(a => a.name.endsWith(".dmg"));
        if (asset) downloadUrl = asset.browser_download_url;
      } else if (plat === "win32") {
        const asset = data.assets.find(a => a.name.endsWith(".exe"));
        if (asset) downloadUrl = asset.browser_download_url;
      } else {
        const asset = data.assets.find(a => a.name.endsWith(".AppImage") && a.name.includes(arch))
          ?? data.assets.find(a => a.name.endsWith(".deb") && a.name.includes(arch));
        if (asset) downloadUrl = asset.browser_download_url;
      }
    }

    return {
      hasUpdate,
      latest,
      current,
      releaseUrl: `https://github.com/ablugg/mizan-canada/releases/latest`,
      downloadUrl,
    };
  } catch {
    return { hasUpdate: false };
  }
});

// --- IPC: Download and install update ---

ipcMain.handle("app:downloadUpdate", async (event, downloadUrl: string) => {
  try {
    const fs = await import("fs");
    const os = await import("os");
    const p = await import("path");

    const res = await fetch(downloadUrl, {
      headers: { "User-Agent": "Mizan-Canada" },
      signal: AbortSignal.timeout(600000),
    });
    if (!res.ok || !res.body) return { ok: false, error: `Download failed (${res.status})` };

    const contentLength = Number(res.headers.get("content-length") ?? 0);
    const fileName = downloadUrl.split("/").pop() ?? "update";
    const tmpDir = os.tmpdir();
    const filePath = p.join(tmpDir, fileName);
    const writeStream = fs.createWriteStream(filePath);

    let downloaded = 0;
    const reader = res.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writeStream.write(Buffer.from(value));
      downloaded += value.byteLength;
      if (!event.sender.isDestroyed() && contentLength > 0) {
        event.sender.send("app:update-progress", {
          downloaded,
          total: contentLength,
          pct: Math.round((downloaded / contentLength) * 100),
        });
      }
    }

    writeStream.end();
    await new Promise<void>((resolve) => writeStream.on("finish", resolve));

    return { ok: true, filePath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

// --- IPC: Open downloaded file and quit ---

ipcMain.handle("app:installUpdate", async (_event, filePath: string) => {
  shell.openPath(filePath);
  setTimeout(() => app.quit(), 1000);
  return { ok: true };
});
