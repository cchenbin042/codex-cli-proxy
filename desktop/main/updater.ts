/**
 * AutoUpdater — checks for updates via electron-updater against GitHub Releases.
 *
 * Behavior:
 *   - Checks for updates on app startup (after backend is ready)
 *   - Downloads updates silently in the background
 *   - Notifies renderer of update-downloaded event
 *   - User can trigger install from the renderer notification
 */

import { autoUpdater, UpdateInfo, ProgressInfo } from "electron-updater";
import { BrowserWindow, dialog } from "electron";

// Configure autoUpdater
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowDowngrade = false;
autoUpdater.logger = {
  info: (msg: string) => console.log(`[updater] ${msg}`),
  warn: (msg: string) => console.warn(`[updater] ${msg}`),
  error: (msg: string) => console.error(`[updater] ${msg}`),
  debug: (msg: string) => console.log(`[updater:debug] ${msg}`),
};

let mainWindow: BrowserWindow | null = null;

export function initAutoUpdater(win: BrowserWindow): void {
  mainWindow = win;

  // ── Events ──────────────────────────────────────────────────────

  autoUpdater.on("checking-for-update", () => {
    console.log("[updater] Checking for updates...");
    mainWindow?.webContents.send("updater:checking");
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    console.log(`[updater] Update available: ${info.version}`);
    mainWindow?.webContents.send("updater:available", {
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[updater] Already up to date.");
    mainWindow?.webContents.send("updater:not-available");
  });

  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    console.log(`[updater] Download: ${progress.percent.toFixed(1)}% (${progress.transferred}/${progress.total})`);
    mainWindow?.webContents.send("updater:progress", {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    console.log(`[updater] Update downloaded: ${info.version}`);
    mainWindow?.webContents.send("updater:downloaded", {
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on("error", (error: Error) => {
    console.error(`[updater] Error: ${error.message}`);
    mainWindow?.webContents.send("updater:error", { message: error.message });

    // Show dialog only for significant errors (not "no update available" etc.)
    if (error.message.includes("check") === false) {
      dialog.showErrorBox("更新检查失败", `无法检查更新：${error.message}`);
    }
  });

  // ── Start Checking ──────────────────────────────────────────────

  // Check 5 seconds after startup (give backend time to start)
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error(`[updater] Check failed: ${err.message}`);
    });
  }, 5000);
}

/**
 * Trigger install of downloaded update. This will quit and restart the app.
 */
export function installUpdate(): void {
  console.log("[updater] Installing update and restarting...");
  autoUpdater.quitAndInstall();
}

/**
 * Manually check for updates (triggered by user from settings panel).
 */
export function checkForUpdates(): void {
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error(`[updater] Manual check failed: ${err.message}`);
  });
}
