import { contextBridge, ipcRenderer } from "electron";

// ── Types ────────────────────────────────────────────────────────

interface BackendInfo {
  status: "stopped" | "starting" | "running" | "stopping" | "error";
  port: number;
  pid: number | null;
  uptime: number;
  startTime: number | null;
  consecutiveHealthFailures: number;
}

interface LogEntry {
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR" | "DEBUG";
  source: string;
  message: string;
}

interface ProxyStats {
  totalRequests: number;
  cacheHits: number;
  errors: number;
  lastRequestTime: string | null;
  lastResponseTime: string | null;
}

// ── Exposed API ──────────────────────────────────────────────────

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  version: "1.0.0",
  getVersion: (): string => "1.0.0",

  // ── Backend lifecycle ──
  startProxy: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("backend:start"),
  stopProxy: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("backend:stop"),
  restartProxy: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("backend:restart"),
  getBackendStatus: (): Promise<BackendInfo> =>
    ipcRenderer.invoke("backend:status"),

  // Backend lifecycle aliases (for plan compatibility)
  startBackend: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("backend:start"),
  stopBackend: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("backend:stop"),
  restartBackend: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("backend:restart"),

  // ── Stats ──
  getStats: (): Promise<ProxyStats> =>
    ipcRenderer.invoke("stats:get"),
 
  getStatsSummary: (): Promise<any> =>
    ipcRenderer.invoke("stats:summary"),

  getDailyStats: (days: number): Promise<any[]> =>
    ipcRenderer.invoke("stats:daily", days),

  // ── Cache ──
  getCacheEntries: (): Promise<any[]> =>
    ipcRenderer.invoke("cache:entries"),

  clearCache: (): Promise<{ success: boolean; data?: any; error?: string }> =>
    ipcRenderer.invoke("cache:clear"),

  setCacheTtl: (ttl: number): Promise<{ success: boolean; data?: any; error?: string }> =>
    ipcRenderer.invoke("cache:ttl", ttl),

  getCacheStatus: (): Promise<{ success: boolean; data?: any; error?: string }> =>
    ipcRenderer.invoke("cache:status"),

  // ── Config (Phase 3) ──
  getConfig: (): Promise<any> =>
    ipcRenderer.invoke("config:get"),
  updateConfig: (config: any): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("config:update", config),

  // ── Provider test (Phase 3) ──
  testProvider: (provider: string, apiKey: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("providers:test", provider, apiKey),

  // ── Audit Logs ──
  getAuditLogs: (date: string): Promise<any[]> =>
    ipcRenderer.invoke("logs:audit", date),

  getAuditDates: (): Promise<string[]> =>
    ipcRenderer.invoke("logs:audit-dates"),

  // ── Event subscriptions ──
  onBackendStatus: (callback: (info: BackendInfo) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: BackendInfo) => callback(info);
    ipcRenderer.on("backend:status", handler);
    return () => ipcRenderer.removeListener("backend:status", handler);
  },

  onLogEntry: (callback: (entry: LogEntry) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, entry: LogEntry) => callback(entry);
    ipcRenderer.on("log:entry", handler);
    return () => ipcRenderer.removeListener("log:entry", handler);
  },

  onCrashExhausted: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on("backend:crash-exhausted", handler);
    return () => ipcRenderer.removeListener("backend:crash-exhausted", handler);
  },

  onPortExhausted: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on("backend:port-exhausted", handler);
    return () => ipcRenderer.removeListener("backend:port-exhausted", handler);
  },

  onStatsUpdate: (callback: (data: any) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on("stats:update", handler);
    return () => ipcRenderer.removeListener("stats:update", handler);
  },

  // ── Auto-launch ──
  getAutoLaunch: (): Promise<boolean> =>
    ipcRenderer.invoke("autolaunch:get"),
  setAutoLaunch: (enabled: boolean): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("autolaunch:set", enabled),

  // ── Auto Updater ──
  checkForUpdates: (): Promise<void> =>
    ipcRenderer.invoke("updater:check"),
  checkUpdate: (): Promise<void> =>
    ipcRenderer.invoke("updater:check"),
  installUpdate: (): Promise<void> =>
    ipcRenderer.invoke("updater:install"),

  onUpdaterChecking: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on("updater:checking", handler);
    return () => ipcRenderer.removeListener("updater:checking", handler);
  },

  onUpdaterAvailable: (callback: (info: { version: string; releaseDate: string }) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, info: { version: string; releaseDate: string }) => callback(info);
    ipcRenderer.on("updater:available", handler);
    return () => ipcRenderer.removeListener("updater:available", handler);
  },

  onUpdaterNotAvailable: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on("updater:not-available", handler);
    return () => ipcRenderer.removeListener("updater:not-available", handler);
  },

  onUpdaterProgress: (callback: (p: { percent: number }) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, p: { percent: number }) => callback(p);
    ipcRenderer.on("updater:progress", handler);
    return () => ipcRenderer.removeListener("updater:progress", handler);
  },

  onUpdaterDownloaded: (callback: (info: { version: string }) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, info: { version: string }) => callback(info);
    ipcRenderer.on("updater:downloaded", handler);
    return () => ipcRenderer.removeListener("updater:downloaded", handler);
  },

  onUpdaterError: (callback: (err: { message: string }) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, err: { message: string }) => callback(err);
    ipcRenderer.on("updater:error", handler);
    return () => ipcRenderer.removeListener("updater:error", handler);
  },
});
