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
    checkUpdate: (): Promise<{ hasUpdate: boolean; latest?: string; current?: string; releaseUrl?: string; downloadUrl?: string }> =>
      ipcRenderer.invoke("app:checkUpdate"),
    hardware: (): Promise<{ totalRam: number; cpuModel: string; cpuCores: number; platform: string; arch: string }> =>
      ipcRenderer.invoke("app:hardware"),
    downloadUpdate: (
      url: string,
      onProgress: (p: { downloaded: number; total: number; pct: number }) => void
    ) => {
      const handler = (_: unknown, progress: unknown) => onProgress(progress as { downloaded: number; total: number; pct: number });
      ipcRenderer.on("app:update-progress", handler);
      return ipcRenderer
        .invoke("app:downloadUpdate", url)
        .finally(() => ipcRenderer.removeListener("app:update-progress", handler)) as Promise<{ ok: boolean; filePath?: string; error?: string }>;
    },
    installUpdate: (filePath: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("app:installUpdate", filePath),
  },
});
