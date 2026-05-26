import { app, BrowserWindow, dialog } from "electron";
import * as path from "path";
import * as fs from "fs";
import { BackendManager } from "./backend-manager";
import { TrayManager } from "./tray-manager";
import { ConfigService } from "./config-service";
import { AutoLaunchManager } from "./auto-launch";
import { registerIpcHandlers, ingestLogForStats } from "./ipc-handlers";
import { initAutoUpdater } from "./updater";
import { StatsCollector } from "./stats-collector";

let mainWindow: BrowserWindow | null = null;
let backend: BackendManager | null = null;
let trayManager: TrayManager | null = null;
let configService: ConfigService | null = null;
let autoLaunch: AutoLaunchManager | null = null;
let statsCollector: StatsCollector | null = null;

// ── Single Instance Lock ──────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  // Another instance is running — exit this one.
  app.quit();
} else {
  app.on("second-instance", () => {
    // Someone tried to launch a second instance — activate our window.
    console.log("[main] Second instance detected. Activating existing window.");
    if (trayManager) {
      trayManager.showWindow();
    } else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ── Path Detection ────────────────────────────────────────────────

function getRendererPath(): string {
  // From dist/main/ → go up 2 levels to desktop/ → renderer/index.html
  const rendererHtml = path.join(__dirname, "..", "..", "renderer", "index.html");
  if (fs.existsSync(rendererHtml)) {
    return rendererHtml;
  }
  return "";
}

// ── Window Creation ───────────────────────────────────────────────

function createLoadingWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 720,
    minHeight: 480,
    title: "cli-proxy",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(
    "data:text/html," +
    encodeURIComponent(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { margin:0; padding:0; font-family:-apple-system,sans-serif;
    background:#0a0a0f; color:#e0e0e8; display:flex; align-items:center;
    justify-content:center; height:100vh; }
  .box { text-align:center; }
  h1 { font-size:2em; font-weight:700; color:#6c8cff; margin:0; }
  p { color:#8888a0; margin:12px 0 0; }
  .spinner { margin-top:20px; width:24px; height:24px; border:3px solid #2a2a3a;
    border-top-color:#6c8cff; border-radius:50%; animation:spin .8s linear infinite;
    display:inline-block; }
  @keyframes spin { to { transform:rotate(360deg); } }
</style></head><body>
  <div class="box"><h1>cli-proxy</h1>
  <p>正在启动代理服务...</p><div class="spinner"></div></div>
</body></html>`)
  );

  win.once("ready-to-show", () => {
    win.show();
  });

  // ── Close to tray (not quit) ──
  win.on("close", (event) => {
    if (trayManager && !trayManager.getIsQuitting()) {
      trayManager.handleWindowClose(event);
    }
  });

  win.on("closed", () => {
    mainWindow = null;
  });

  return win;
}

function loadRenderer(win: BrowserWindow): void {
  const rendererPath = getRendererPath();
  if (rendererPath) {
    console.log(`[main] Loading renderer: ${rendererPath}`);
    win.loadFile(rendererPath);
  } else {
    console.log("[main] Renderer not found, keeping loading page.");
  }

  // Open DevTools in development only
  if (!app.isPackaged) {
    win.webContents.openDevTools();
  }
}

// ── IPC Handlers ──────────────────────────────────────────────────

// Registered via ipc-handlers.ts (called in app.whenReady below)

// ── Crash / Error Dialogs ─────────────────────────────────────────

function setupErrorHandlers(bm: BackendManager): void {
  bm.on("crash-exhausted", () => {
    console.error("[main] Backend crash-exhausted. Showing error dialog.");
    dialog.showErrorBox(
      "代理启动失败",
      "代理服务反复崩溃，已停止自动重试。\n\n" +
      "请检查：\n" +
      "  • Python 环境是否正常\n" +
      "  • config.yaml 中的 API Key 是否有效\n" +
      "  • 端口是否被其他程序占用\n\n" +
      "修复后请手动重启代理：托盘右键 → 启动代理"
    );
    // Notify renderer
    mainWindow?.webContents.send("backend:crash-exhausted");
  });

  bm.on("port-exhausted", () => {
    console.error("[main] Port range exhausted. Showing error dialog.");
    dialog.showErrorBox(
      "端口被占用",
      "端口 8317-8321 全部被其他程序占用。\n\n" +
      "请关闭占用这些端口的程序后重试，\n" +
      "或在设置中修改代理端口。"
    );
    mainWindow?.webContents.send("backend:port-exhausted");
  });
}

// ── App Lifecycle ─────────────────────────────────────────────────

app.whenReady().then(async () => {
  console.log("[main] App ready. Starting backend...");

  // Create the loading window first
  mainWindow = createLoadingWindow();

  // Initialize backend
  backend = new BackendManager();

  // Initialize config service (reads ~/.cli-proxy/config.yaml + vault.bin)
  configService = new ConfigService(() => {
    // Config changed → restart Python backend
    console.log("[main] Config change detected. Restarting backend...");
    backend?.restart().catch((e) => {
      console.error(`[main] Config-triggered restart failed: ${e.message}`);
    });
  });

  // Setup error handlers (dialogs for crash-exhausted, port-exhausted)
  setupErrorHandlers(backend);

  // ── Initialize StatsCollector (incremental JSONL parsing) ──
  const projectRoot = path.join(__dirname, "..", "..", "..");
  const auditDir = path.join(projectRoot, "audit_logs");
  statsCollector = new StatsCollector(auditDir, 30000);
  statsCollector.on("update", (summary, dailyStats) => {
    mainWindow?.webContents.send("stats:update", { summary, dailyStats });
  });
  statsCollector.start();

  // ── Forward backend events to renderer + stats ingestion ──
  backend.on("status-changed", (newStatus: string) => {
    console.log(`[main] Backend status: ${newStatus}`);
    mainWindow?.webContents.send("backend:status", backend!.getInfo());
  });

  backend.on("stdout", (line: string) => {
    // Ingest for legacy stats (still used by stats:get IPC)
    ingestLogForStats(line);

    mainWindow?.webContents.send("log:entry", {
      timestamp: new Date().toISOString(),
      level: "INFO",
      source: "python",
      message: line,
    });
  });

  backend.on("stderr", (line: string) => {
    mainWindow?.webContents.send("log:entry", {
      timestamp: new Date().toISOString(),
      level: line.includes("ERROR") || line.includes("Traceback") ? "ERROR"
        : line.includes("WARNING") ? "WARN" : "INFO",
      source: "python",
      message: line,
    });
  });

  // Initialize auto-launch manager (must be created before registerIpcHandlers)
  autoLaunch = new AutoLaunchManager();

  // Register IPC handlers (requires backend + configService + autoLaunch + statsCollector)
  registerIpcHandlers(backend, configService, autoLaunch, statsCollector);

  // ── Initialize system tray ──
  trayManager = new TrayManager(backend, mainWindow, autoLaunch, configService);
  trayManager.init();

  // ── Start backend ──
  // Inject API keys from config into environment before starting Python
  const pyEnv = configService.getEnvForPython();
  for (const [key, value] of Object.entries(pyEnv)) {
    process.env[key] = value;
    console.log(`[main] Env: ${key}=${value.substring(0, 12)}...`);
  }

  // If started with --minimized (auto-launch), don't show window
  const startMinimized = process.argv.includes("--minimized");
  if (startMinimized && mainWindow) {
    mainWindow.hide();
    console.log("[main] Started minimized (auto-launch).");
  }
  try {
    await backend.start();
    console.log("[main] Backend is ready. Loading renderer...");
    loadRenderer(mainWindow);
    // Start checking for app updates (non-blocking)
    initAutoUpdater(mainWindow);
  } catch (e: any) {
    console.error(`[main] Backend failed to start: ${e.message}`);
    loadRenderer(mainWindow);
  }

  // macOS: re-create window on activate
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createLoadingWindow();
      // Update tray's window reference
      if (trayManager) {
        (trayManager as any).mainWindow = mainWindow;
      }
      if (backend?.getStatus() === "running") {
        loadRenderer(mainWindow);
      } else {
        backend?.start().then(() => {
          if (mainWindow) loadRenderer(mainWindow);
        }).catch(() => {});
      }
    }
  });
});

// ── Global quit handlers ──────────────────────────────────────────

app.on("window-all-closed", () => {
  // On Windows/Linux, stay running in tray — don't quit.
  // Only quit if trayManager signals it's quitting.
  if (trayManager?.getIsQuitting()) {
    // Will proceed to before-quit
  }
  // Otherwise, keep running in the tray
});

app.on("before-quit", async () => {
  console.log("[main] App quitting. Cleaning up...");
  if (statsCollector) {
    statsCollector.stop();
  }
  if (trayManager) {
    trayManager.setQuitting();
    trayManager.destroy();
  }
  if (backend) {
    try {
      await backend.stop();
    } catch (e: any) {
      console.error(`[main] Error stopping backend: ${e.message}`);
    }
  }
});
