import { app, BrowserWindow, ipcMain, shell, Menu, globalShortcut } from "electron";
import { autoUpdater } from "electron-updater";
import path from "path";
import { startNextServer, stopNextServer } from "./server";
import { OllamaManager } from "./ollama";

// Remove default Electron menu bar -- app is entirely self-contained
Menu.setApplicationMenu(null);

// Set the app name so macOS menu bar and dock show "Mizan"
app.setName("Mizan");

// Enforce single instance -- second launch focuses the existing window instead
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
    console.error(`[main] Page load failed (${code}: ${desc}), retrying in 1s...`);
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

// --- Auto-updater setup ---

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function sendUpdateStatus(channel: string, data: unknown) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

autoUpdater.on("update-available", (info) => {
  sendUpdateStatus("updater:update-available", { version: info.version });
});

autoUpdater.on("update-not-available", () => {
  sendUpdateStatus("updater:update-not-available", {});
});

autoUpdater.on("download-progress", (progress) => {
  sendUpdateStatus("updater:download-progress", { pct: Math.round(progress.percent) });
});

autoUpdater.on("update-downloaded", () => {
  sendUpdateStatus("updater:update-downloaded", {});
});

autoUpdater.on("error", (err) => {
  sendUpdateStatus("updater:error", { message: err.message });
});

app.whenReady().then(async () => {
  // Start Ollama in the background -- it is non-blocking.
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

// --- IPC: Auto-updater ---

ipcMain.handle("updater:check", async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result && result.updateInfo) {
      return { hasUpdate: true, version: result.updateInfo.version };
    }
    return { hasUpdate: false };
  } catch {
    return { hasUpdate: false };
  }
});

ipcMain.handle("updater:download", () => {
  autoUpdater.downloadUpdate();
});

ipcMain.handle("updater:install", () => {
  autoUpdater.quitAndInstall(false, true);
});
