/**
 * TrayManager — manages the system tray icon and context menu.
 *
 * Displays a colored dot icon indicating backend status:
 *   green  = running
 *   gray   = stopped
 *   red    = error
 *
 * Right-click menu provides quick access to common actions.
 * Double-click the tray icon to show/focus the main window.
 */

import { Tray, Menu, nativeImage, BrowserWindow, dialog, app } from "electron";
import { BackendManager, BackendStatus } from "./backend-manager";
import { AutoLaunchManager } from "./auto-launch";
import { ConfigService } from "./config-service";
import { DEFAULT_PROVIDER } from "./ipc-handlers";

// ── Icon Generation ──────────────────────────────────────────────

/**
 * Generate a simple 16x16 colored circle icon as a NativeImage.
 * Uses raw BGRA pixel buffer.
 */
function createTrayIcon(color: "green" | "gray" | "red"): Electron.NativeImage {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4); // BGRA

  const r = size / 2;
  const cx = size / 2;
  const cy = size / 2;

  // RGB values for each status color
  const colors: Record<string, [number, number, number]> = {
    green: [52, 211, 153],   // #34d399
    gray: [136, 136, 160],   // #8888a0
    red: [248, 113, 113],    // #f87171
  };

  const [cr, cg, cb] = colors[color];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const edge = 1.0; // anti-aliased edge width

      let alpha: number;
      if (dist <= r - edge) {
        alpha = 255;
      } else if (dist <= r) {
        alpha = Math.round(255 * (1 - (dist - (r - edge)) / edge));
      } else {
        alpha = 0;
      }

      buf[idx] = cb;       // B
      buf[idx + 1] = cg;   // G
      buf[idx + 2] = cr;   // R
      buf[idx + 3] = alpha; // A
    }
  }

  return nativeImage.createFromBuffer(buf, {
    width: size,
    height: size,
  });
}

// Pre-render icons at module load
const ICON_RUNNING = createTrayIcon("green");
const ICON_STOPPED = createTrayIcon("gray");
const ICON_ERROR = createTrayIcon("red");

// ── TrayManager ──────────────────────────────────────────────────

export class TrayManager {
  private tray: Tray | null = null;
  private backend: BackendManager;
  private autoLaunch: AutoLaunchManager | null;
  private configService: ConfigService | null;
  private mainWindow: BrowserWindow | null;
  private isQuitting: boolean = false;

  constructor(
    backend: BackendManager,
    mainWindow: BrowserWindow | null,
    autoLaunch?: AutoLaunchManager,
    configService?: ConfigService,
  ) {
    this.backend = backend;
    this.mainWindow = mainWindow;
    this.autoLaunch = autoLaunch || null;
    this.configService = configService || null;
  }

  /**
   * Initialize the system tray. Call once after the app is ready.
   */
  init(): void {
    const icon = this.getIconForStatus(this.backend.getStatus());
    this.tray = new Tray(icon);
    this.tray.setToolTip("cli-proxy");

    // Right-click context menu
    this.updateMenu();

    // Double-click → show/focus window
    this.tray.on("double-click", () => {
      this.showWindow();
    });

    // Listen to backend status changes
    this.backend.on("status-changed", (newStatus: BackendStatus) => {
      this.updateIcon(newStatus);
      this.updateMenu();
    });

    console.log("[tray] Initialized.");
  }

  /**
   * Mark the app as quitting (used by the "Quit" menu action).
   */
  setQuitting(): void {
    this.isQuitting = true;
  }

  getIsQuitting(): boolean {
    return this.isQuitting;
  }

  /**
   * Destroy the tray. Call before app quits.
   */
  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
    console.log("[tray] Destroyed.");
  }

  // ── Window Management ────────────────────────────────────────

  showWindow(): void {
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) this.mainWindow.restore();
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }

  /**
   * Handle window close: hide to tray instead of quitting.
   */
  handleWindowClose(event: Electron.Event): void {
    if (!this.isQuitting) {
      event.preventDefault();
      this.mainWindow?.hide();
      console.log("[tray] Window hidden to tray.");
    }
  }

  // ── Internal ─────────────────────────────────────────────────

  private getIconForStatus(status: BackendStatus): Electron.NativeImage {
    switch (status) {
      case "running": return ICON_RUNNING;
      case "error":   return ICON_ERROR;
      default:        return ICON_STOPPED;
    }
  }

  private updateIcon(status: BackendStatus): void {
    if (this.tray) {
      this.tray.setImage(this.getIconForStatus(status));
    }
  }

  private updateMenu(): void {
    if (!this.tray) return;

    const status = this.backend.getStatus();
    const info = this.backend.getInfo();
    const isRunning = status === "running";
    const isStarting = status === "starting";
    const isStopping = status === "stopping";
    const isBusy = isStarting || isStopping;

    // Status labels
    const statusLabels: Record<string, string> = {
      running: `代理: 运行中 · 端口 ${info.port}`,
      starting: "代理: 启动中...",
      stopping: "代理: 停止中...",
      stopped: "代理: 已停止",
      error: "代理: 错误",
    };

    // Current provider display
    let providerLabel = "供应商: —";
    if (this.configService) {
      const config = this.configService.load();
      const defaultProvider = config.model_map?.["__default__"] || DEFAULT_PROVIDER;
      providerLabel = `供应商: ${defaultProvider} (主)`;
    }

    // Build provider switch submenu
    const providerItems: Electron.MenuItemConstructorOptions[] = [];
    if (this.configService) {
      const config = this.configService.load();
      // Collect all provider names from providers section + deepseek
      const allProviders = new Set<string>([DEFAULT_PROVIDER]);
      for (const pname of Object.keys(config.providers || {})) {
        allProviders.add(pname);
      }
      const defaultProvider = config.model_map?.["__default__"] || DEFAULT_PROVIDER;

      for (const pname of allProviders) {
        providerItems.push({
          label: pname === DEFAULT_PROVIDER ? "DeepSeek (默认)" : pname,
          type: "radio",
          checked: pname === defaultProvider,
          click: () => {
            const cfg = this.configService!.load();
            cfg.model_map = cfg.model_map || {};
            cfg.model_map["__default__"] = pname;
            this.configService!.save(cfg);
          },
        });
      }
    }

    const contextMenu = Menu.buildFromTemplate([
      {
        label: statusLabels[status] || `代理: ${status}`,
        enabled: false,
      },
      {
        label: providerLabel,
        enabled: false,
      },
      { type: "separator" },
      {
        label: "打开主面板",
        click: () => this.showWindow(),
      },
      {
        label: "切换供应商",
        submenu: providerItems.length > 0
          ? providerItems
          : [{ label: "暂无供应商", enabled: false }],
      },
      { type: "separator" },
      {
        label: isRunning ? "停止代理" : "启动代理",
        enabled: !isBusy,
        click: async () => {
          if (isRunning) {
            await this.backend.stop();
          } else {
            try {
              await this.backend.start();
            } catch (e: any) {
              dialog.showErrorBox("启动失败", `代理启动失败: ${e.message}`);
            }
          }
        },
      },
      {
        label: "重启代理",
        enabled: isRunning,
        click: async () => {
          try {
            await this.backend.restart();
          } catch (e: any) {
            dialog.showErrorBox("重启失败", `代理重启失败: ${e.message}`);
          }
        },
      },
      { type: "separator" },
      {
        label: "开机自启",
        type: "checkbox",
        checked: this.autoLaunch?.isEnabled() ?? false,
        enabled: this.autoLaunch !== null,
        click: () => {
          if (this.autoLaunch) {
            this.autoLaunch.toggle();
            this.updateMenu();
          }
        },
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          this.isQuitting = true;
          app.quit();
        },
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }
}
