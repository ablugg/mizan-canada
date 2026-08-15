import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electron", {
  ollama: {
    modelExists: (model: string) =>
      ipcRenderer.invoke("ollama:model-exists", model),

    pullModel: (
      model: string,
      onProgress: (p: { status: string; total?: number; completed?: number }) => void
    ) => {
      const handler = (_: unknown, progress: unknown) => onProgress(progress as { status: string; total?: number; completed?: number });
      ipcRenderer.on("ollama:pull-progress", handler);
      return ipcRenderer
        .invoke("ollama:pull-model", model)
        .finally(() => ipcRenderer.removeListener("ollama:pull-progress", handler));
    },
  },

  app: {
    version: () => ipcRenderer.invoke("app:version"),
    userData: () => ipcRenderer.invoke("app:userData"),
    hardware: (): Promise<{ totalRam: number; cpuModel: string; cpuCores: number; platform: string; arch: string }> =>
      ipcRenderer.invoke("app:hardware"),
  },

  updater: {
    check: (): Promise<{ hasUpdate: boolean; version?: string }> =>
      ipcRenderer.invoke("updater:check"),

    download: () => ipcRenderer.invoke("updater:download"),

    install: () => ipcRenderer.invoke("updater:install"),

    onUpdateAvailable: (cb: (info: { version: string }) => void) => {
      const handler = (_: unknown, data: unknown) => cb(data as { version: string });
      ipcRenderer.on("updater:update-available", handler);
      return () => ipcRenderer.removeListener("updater:update-available", handler);
    },

    onUpdateNotAvailable: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on("updater:update-not-available", handler);
      return () => ipcRenderer.removeListener("updater:update-not-available", handler);
    },

    onDownloadProgress: (cb: (info: { pct: number }) => void) => {
      const handler = (_: unknown, data: unknown) => cb(data as { pct: number });
      ipcRenderer.on("updater:download-progress", handler);
      return () => ipcRenderer.removeListener("updater:download-progress", handler);
    },

    onUpdateDownloaded: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on("updater:update-downloaded", handler);
      return () => ipcRenderer.removeListener("updater:update-downloaded", handler);
    },

    onError: (cb: (info: { message: string }) => void) => {
      const handler = (_: unknown, data: unknown) => cb(data as { message: string });
      ipcRenderer.on("updater:error", handler);
      return () => ipcRenderer.removeListener("updater:error", handler);
    },
  },
});
