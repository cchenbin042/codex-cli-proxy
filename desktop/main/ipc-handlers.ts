/**
 * ipc-handlers.ts — IPC handler registration.
 *
 * Registers all ipcMain.handle() channels and manages the in-memory
 * stats counter that feeds the dashboard.
 */

import { ipcMain } from "electron";
import * as https from "https";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { BackendManager } from "./backend-manager";
import { ConfigService } from "./config-service";
import { AutoLaunchManager } from "./auto-launch";
import { checkForUpdates, installUpdate } from "./updater";
import { StatsCollector } from "./stats-collector";

// ── Constants ────────────────────────────────────────────────────

export const DEFAULT_PROVIDER = "deepseek";

// ── IPC Registration ─────────────────────────────────────────────

export function registerIpcHandlers(
  backend: BackendManager,
  configService: ConfigService,
  autoLaunch?: AutoLaunchManager,
  statsCollector?: StatsCollector,
  auditDir?: string,
): void {
  // ── Backend lifecycle ──
  ipcMain.handle("backend:status", () => {
    return backend.getInfo();
  });

  ipcMain.handle("backend:start", async () => {
    try {
      await backend.start();
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("backend:stop", async () => {
    try {
      await backend.stop();
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("backend:restart", async () => {
    try {
      await backend.restart();
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // ── Config ──
  ipcMain.handle("config:get", () => {
    return configService.load();
  });

  ipcMain.handle("config:update", async (_event, newConfig: any) => {
    try {
      configService.save(newConfig);
      // configService 会通过 debounce 回调触发重启
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // ── Provider connectivity test ──
  ipcMain.handle("providers:test", async (_event, provider: string, apiKey: string) => {
    try {
      const config = configService.load();
      const pcfg = config.providers?.[provider];
      const apiBase = pcfg?.api_base || config.deepseek.api_base;

      const startTime = Date.now();
      const result = await testProviderConnectivity(apiBase, apiKey);
      const latency = Date.now() - startTime;

      if (result.success) {
        return { success: true, latency: `${latency}ms` };
      } else {
        return { success: false, error: result.error };
      }
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // ── Auto-launch ──
  ipcMain.handle("autolaunch:get", () => {
    return autoLaunch?.isEnabled() ?? false;
  });

  ipcMain.handle("autolaunch:set", (_event, enabled: boolean) => {
    if (!autoLaunch) return { success: false };
    if (enabled) {
      autoLaunch.enable();
    } else {
      autoLaunch.disable();
    }
    return { success: true };
  });

  // ── Auto Updater ──
  ipcMain.handle("updater:check", async () => {
    checkForUpdates();
  });

  ipcMain.handle("updater:install", () => {
    installUpdate();
  });

  // ── Stats Collector ──
  if (statsCollector) {
    ipcMain.handle("stats:summary", () => {
      return statsCollector.getSummary();
    });

    ipcMain.handle("stats:daily", (_event, days: number) => {
      return statsCollector.getDailyStats(days || 7);
    });

    ipcMain.handle("stats:get", () => {
      return statsCollector.getSummary();
    });

    ipcMain.handle("cache:entries", () => {
      return statsCollector.getCacheEntries();
    });
  }

  // ── Audit Logs ──
  const auditLogDir = auditDir || path.join(path.join(__dirname, "..", "..", ".."), "audit_logs");

  ipcMain.handle("logs:audit", async (_event, date: string) => {
    // Validate date format: only allow YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    const filePath = path.resolve(auditLogDir, `${date}.jsonl`);
    // Prevent path traversal: ensure resolved path is still within auditLogDir
    if (!filePath.startsWith(path.resolve(auditLogDir))) return [];
    try {
      if (!fs.existsSync(filePath)) return [];
      const content = fs.readFileSync(filePath, "utf-8");
      return content
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => {
          try { return JSON.parse(l); } catch { return null; }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  });

  ipcMain.handle("logs:audit-dates", async () => {
    try {
      if (!fs.existsSync(auditLogDir)) return [];
      return fs.readdirSync(auditLogDir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => f.replace(".jsonl", ""))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  });

  // ── Cache Management (via Python backend) ──
  ipcMain.handle("cache:clear", async () => {
    const info = backend.getInfo();
    if (info.status !== "running") {
      return { success: false, error: "Backend is not running" };
    }
    return httpRequest("POST", `http://localhost:${info.port}/cache/clear`);
  });

  ipcMain.handle("cache:ttl", async (_event, ttl: number) => {
    const info = backend.getInfo();
    if (info.status !== "running") {
      return { success: false, error: "Backend is not running" };
    }
    return httpRequest("POST", `http://localhost:${info.port}/cache/ttl`, { ttl });
  });

  ipcMain.handle("cache:status", async () => {
    const info = backend.getInfo();
    if (info.status !== "running") {
      return { success: false, error: "Backend is not running" };
    }
    return httpRequest("GET", `http://localhost:${info.port}/cache/status`);
  });
}

// ── Provider Connectivity Test ───────────────────────────────────

async function testProviderConnectivity(
  apiBase: string,
  apiKey: string
): Promise<{ success: boolean; error?: string }> {
  const url = new URL("/v1/models", apiBase);

  return new Promise((resolve) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString()));
        res.on("end", () => {
          if (res.statusCode === 200 || res.statusCode === 401) {
            resolve({
              success: res.statusCode === 200,
              error: res.statusCode === 401 ? "401 Unauthorized — API Key 无效" : undefined,
            });
          } else {
            try {
              const json = JSON.parse(body);
              resolve({ success: false, error: json.error?.message || `HTTP ${res.statusCode}` });
            } catch {
              resolve({ success: false, error: `HTTP ${res.statusCode}` });
            }
          }
        });
      }
    );

    req.on("error", (err: any) => {
      resolve({ success: false, error: err.code === "ENOTFOUND" ? "无法解析域名" : err.message });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ success: false, error: "连接超时 (10s)" });
    });

    req.end();
  });
}

// ── HTTP Request Helper ───────────────────────────────────────────

function httpRequest(
  method: string,
  url: string,
  body?: any,
): Promise<any> {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const req = http.request(
      parsed,
      {
        method,
        headers: { "Content-Type": "application/json" },
        timeout: 5000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () => {
          try {
            resolve({ success: true, data: JSON.parse(data) });
          } catch {
            resolve({ success: false, error: `Invalid response: ${data}` });
          }
        });
      },
    );

    req.on("error", (err: any) => {
      resolve({ success: false, error: err.message });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ success: false, error: "Request timed out" });
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}
