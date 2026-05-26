/**
 * AutoLaunchManager — manages "start on boot" functionality.
 *
 * Uses Electron's built-in app.setLoginItemSettings() which handles:
 *   Windows → Registry HKCU\Software\Microsoft\Windows\CurrentVersion\Run
 *   macOS   → LaunchAgent plist
 *   Linux   → ~/.config/autostart .desktop file
 *
 * No external dependencies required.
 */

import { app } from "electron";

export class AutoLaunchManager {
  private enabled: boolean;

  constructor() {
    // Read current state from OS
    this.enabled = app.getLoginItemSettings().openAtLogin;
    console.log(`[autolaunch] Initial state: ${this.enabled ? "enabled" : "disabled"}`);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  enable(): void {
    if (this.enabled) return;
    app.setLoginItemSettings({
      openAtLogin: true,
      args: ["--minimized"], // start minimized to tray
    });
    this.enabled = true;
    console.log("[autolaunch] Enabled — app will start on boot.");
  }

  disable(): void {
    if (!this.enabled) return;
    app.setLoginItemSettings({
      openAtLogin: false,
    });
    this.enabled = false;
    console.log("[autolaunch] Disabled.");
  }

  toggle(): boolean {
    if (this.enabled) {
      this.disable();
    } else {
      this.enable();
    }
    return this.enabled;
  }
}
