// src/lib/api/ipc.ts
// Electron IPC 类型安全封装 — 通过 preload 暴露的 window.electronAPI 调用主进程
//
// 浏览器 dev 模式下 window.electronAPI 不存在，返回无操作 mock 避免崩溃。

// ---------------------------------------------------------------------------
// Types (mirrors preload.ts + ipc-handlers.ts)
// ---------------------------------------------------------------------------

export interface BackendInfo {
  status: "stopped" | "starting" | "running" | "stopping" | "error";
  port: number;
  pid: number | null;
  uptime: number;
  startTime: number | null;
  consecutiveHealthFailures: number;
}

export interface LogEntry {
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR" | "DEBUG";
  source: string;
  message: string;
}

export interface StatsSummary {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  cacheHitRate: number;
  cacheHits: number;
  totalRequests: number;
  totalErrors: number;
  healthyProviders: number;
  totalProviders: number;
  avgLatencyMs: number;
  streamRatio: number;
}

export interface DailyStats {
  date: string;
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCacheHits: number;
  totalErrors: number;
  avgLatencyMs: number;
  byProvider: Record<string, { requests: number; tokens: number }>;
  byModel: Record<string, { requests: number; tokens: number }>;
}

export interface ProviderConfig {
  api_base: string;
  api_keys: string[];
  enabled: boolean;
}

export interface AppConfig {
  server: { host: string; port: number };
  deepseek: { api_base: string; api_keys: string[]; thinking_disabled: boolean };
  model_map: Record<string, string>;
  reliability: {
    retry: { max_retries: number; backoff_base_seconds: number };
    circuit_breaker: { failure_threshold: number; cooldown_seconds: number };
    concurrency: { max_concurrent: number; queue_timeout_seconds: number };
    rate_limit: { requests_per_minute: number; burst_capacity: number };
  };
  providers: Record<string, ProviderConfig>;
}

// ---------------------------------------------------------------------------
// window.electronAPI 类型声明
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    electronAPI?: {
      platform: string;
      version: string;
      // invoke
      startProxy: () => Promise<{ success: boolean; error?: string }>;
      stopProxy: () => Promise<{ success: boolean; error?: string }>;
      restartProxy: () => Promise<{ success: boolean; error?: string }>;
      startBackend: () => Promise<{ success: boolean; error?: string }>;
      stopBackend: () => Promise<{ success: boolean; error?: string }>;
      restartBackend: () => Promise<{ success: boolean; error?: string }>;
      getBackendStatus: () => Promise<BackendInfo>;
      getConfig: () => Promise<AppConfig>;
      updateConfig: (config: AppConfig) => Promise<{ success: boolean; error?: string }>;
      testProvider: (provider: string, apiKey: string) => Promise<{ success: boolean; latency?: string; error?: string }>;
      getStatsSummary: () => Promise<StatsSummary>;
      getDailyStats: (days: number) => Promise<DailyStats[]>;
      getAuditLogs: (date: string) => Promise<object[]>;
      getAuditDates: () => Promise<string[]>;
      getAutoLaunch: () => Promise<boolean>;
      setAutoLaunch: (enabled: boolean) => Promise<{ success: boolean }>;
      checkForUpdates: () => Promise<void>;
      checkUpdate: () => Promise<void>;
      installUpdate: () => Promise<void>;
      getStats: () => Promise<{ totalRequests: number; cacheHits: number; errors: number; lastRequestTime: string | null; lastResponseTime: string | null }>;
      getCacheEntries: () => Promise<{ model: string; requests: number; tokens: number; cacheHits: number }[]>;
      clearCache: () => Promise<{ success: boolean; cleared?: number; error?: string }>;
      setCacheTtl: (ttl: number) => Promise<{ success: boolean; ttl?: number; error?: string }>;
      getCacheStatus: () => Promise<{ entries: number; max_size: number; ttl_seconds: number }>;
      // events (returns unsubscribe)
      onBackendStatus: (cb: (info: BackendInfo) => void) => () => void;
      onLogEntry: (cb: (entry: LogEntry) => void) => () => void;
      onStatsUpdate: (cb: (data: { summary: StatsSummary; dailyStats: DailyStats[] }) => void) => () => void;
      onCrashExhausted: (cb: () => void) => () => void;
      onPortExhausted: (cb: () => void) => () => void;
      onUpdaterChecking: (cb: () => void) => () => void;
      onUpdaterAvailable: (cb: (info: { version: string; releaseDate: string }) => void) => () => void;
      onUpdaterNotAvailable: (cb: () => void) => () => void;
      onUpdaterProgress: (cb: (p: { percent: number }) => void) => () => void;
      onUpdaterDownloaded: (cb: (info: { version: string }) => void) => () => void;
      onUpdaterError: (cb: (err: { message: string }) => void) => () => void;
    };
  }
}

// ---------------------------------------------------------------------------
// Helper: get electronAPI or return mock
// ---------------------------------------------------------------------------

function api(): NonNullable<Window["electronAPI"]> {
  if (window.electronAPI) return window.electronAPI;

  // Browser dev mode — return a mock that logs and returns empty/void
  const noop = () => {};
  const noopUnsub = () => () => {};
  return {
    platform: "browser",
    version: "dev",
    startProxy: async () => ({ success: false, error: "Electron 环境不可用" }),
    stopProxy: async () => ({ success: false, error: "Electron 环境不可用" }),
    restartProxy: async () => ({ success: false, error: "Electron 环境不可用" }),
    startBackend: async () => ({ success: false, error: "Electron 环境不可用" }),
    stopBackend: async () => ({ success: false, error: "Electron 环境不可用" }),
    restartBackend: async () => ({ success: false, error: "Electron 环境不可用" }),
    getBackendStatus: async () => ({ status: "stopped" as const, port: 8317, pid: null, uptime: 0, startTime: null, consecutiveHealthFailures: 0 }),
    getConfig: async () => ({ server: { host: "127.0.0.1", port: 8317 }, deepseek: { api_base: "", api_keys: [], thinking_disabled: false }, model_map: {}, reliability: { retry: { max_retries: 3, backoff_base_seconds: 2 }, circuit_breaker: { failure_threshold: 5, cooldown_seconds: 30 }, concurrency: { max_concurrent: 10, queue_timeout_seconds: 30 }, rate_limit: { requests_per_minute: 30, burst_capacity: 30 } }, providers: {} }),
    updateConfig: async () => ({ success: false, error: "Electron 环境不可用" }),
    testProvider: async () => ({ success: false, error: "Electron 环境不可用" }),
    getStatsSummary: async () => ({ totalTokens: 0, promptTokens: 0, completionTokens: 0, cacheHitRate: 0, cacheHits: 0, totalRequests: 0, totalErrors: 0, healthyProviders: 0, totalProviders: 0, avgLatencyMs: 0, streamRatio: 0 }),
    getDailyStats: async () => [],
    getAuditLogs: async () => [],
    getAuditDates: async () => [],
    getAutoLaunch: async () => false,
    setAutoLaunch: async () => ({ success: false }),
    checkForUpdates: async () => {},
    checkUpdate: async () => {},
    installUpdate: async () => {},
    getStats: async () => ({ totalRequests: 0, cacheHits: 0, errors: 0, lastRequestTime: null, lastResponseTime: null }),
    getCacheEntries: async () => [],
    clearCache: async () => ({ success: false, error: "Electron 环境不可用" }),
    setCacheTtl: async () => ({ success: false, error: "Electron 环境不可用" }),
    getCacheStatus: async () => ({ entries: 0, max_size: 0, ttl_seconds: 300 }),
    onBackendStatus: noopUnsub,
    onLogEntry: noopUnsub,
    onStatsUpdate: noopUnsub,
    onCrashExhausted: noopUnsub,
    onPortExhausted: noopUnsub,
    onUpdaterChecking: noopUnsub,
    onUpdaterAvailable: noopUnsub,
    onUpdaterNotAvailable: noopUnsub,
    onUpdaterProgress: noopUnsub,
    onUpdaterDownloaded: noopUnsub,
    onUpdaterError: noopUnsub,
  };
}

// ---------------------------------------------------------------------------
// Exported API — mirrors preload.ts surface exactly
// ---------------------------------------------------------------------------

export const electronAPI = {
  get platform() { return api().platform; },
  get version() { return api().version; },

  // Backend lifecycle
  startProxy: () => api().startProxy(),
  stopProxy: () => api().stopProxy(),
  restartProxy: () => api().restartProxy(),
  startBackend: () => api().startBackend(),
  stopBackend: () => api().stopBackend(),
  restartBackend: () => api().restartBackend(),
  getBackendStatus: () => api().getBackendStatus(),

  // Config
  getConfig: () => api().getConfig(),
  updateConfig: (config: AppConfig) => api().updateConfig(config),

  // Provider test
  testProvider: (provider: string, apiKey: string) => api().testProvider(provider, apiKey),

  // Stats
  getStatsSummary: () => api().getStatsSummary(),
  getDailyStats: (days: number) => api().getDailyStats(days),
  getStats: () => api().getStats(),
  getCacheEntries: () => api().getCacheEntries(),
  clearCache: () => api().clearCache(),
  setCacheTtl: (ttl: number) => api().setCacheTtl(ttl),
  getCacheStatus: () => api().getCacheStatus(),

  // Audit logs
  getAuditLogs: (date: string) => api().getAuditLogs(date),
  getAuditDates: () => api().getAuditDates(),

  // Auto-launch
  getAutoLaunch: () => api().getAutoLaunch(),
  setAutoLaunch: (enabled: boolean) => api().setAutoLaunch(enabled),

  // Updater
  checkForUpdates: () => api().checkForUpdates(),
  checkUpdate: () => api().checkUpdate(),
  installUpdate: () => api().installUpdate(),

  // Events
  onBackendStatus: (cb: (info: BackendInfo) => void) => api().onBackendStatus(cb),
  onLogEntry: (cb: (entry: LogEntry) => void) => api().onLogEntry(cb),
  onStatsUpdate: (cb: (data: { summary: StatsSummary; dailyStats: DailyStats[] }) => void) => api().onStatsUpdate(cb),
  onCrashExhausted: (cb: () => void) => api().onCrashExhausted(cb),
  onPortExhausted: (cb: () => void) => api().onPortExhausted(cb),
  onUpdaterChecking: (cb: () => void) => api().onUpdaterChecking(cb),
  onUpdaterAvailable: (cb: (info: { version: string; releaseDate: string }) => void) => api().onUpdaterAvailable(cb),
  onUpdaterNotAvailable: (cb: () => void) => api().onUpdaterNotAvailable(cb),
  onUpdaterProgress: (cb: (p: { percent: number }) => void) => api().onUpdaterProgress(cb),
  onUpdaterDownloaded: (cb: (info: { version: string }) => void) => api().onUpdaterDownloaded(cb),
  onUpdaterError: (cb: (err: { message: string }) => void) => api().onUpdaterError(cb),
};
