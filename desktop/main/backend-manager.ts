/**
 * BackendManager — manages the lifecycle of the Python uvicorn proxy backend.
 *
 * State machine: stopped → starting → running → stopping → stopped
 *                                     ↘ error
 *
 * Events:
 *   status-changed  (newStatus, oldStatus)
 *   stdout          (line: string)
 *   stderr          (line: string)
 *   crash-exhausted ()              — max retries exceeded
 *   port-exhausted  ()              — no available port in range
 */

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import * as http from "http";
import * as path from "path";
import * as fs from "fs";
import { app } from "electron";

// ── Types ────────────────────────────────────────────────────────

export type BackendStatus = "stopped" | "starting" | "running" | "stopping" | "error";

export interface BackendInfo {
  status: BackendStatus;
  port: number;
  pid: number | null;
  uptime: number;            // ms since entering 'running' state
  startTime: number | null;  // Date.now() when entering 'running'
  consecutiveHealthFailures: number;
}

// ── Constants ────────────────────────────────────────────────────

const DEFAULT_PORT = 8317;
const PORT_RANGE_START = 8317;
const PORT_RANGE_END = 8321;
const STARTUP_HEALTH_INTERVAL_MS = 500;
const STARTUP_HEALTH_TIMEOUT_MS = 15_000;
const RUNTIME_HEALTH_INTERVAL_MS = 5_000;
const MAX_CONSECUTIVE_HEALTH_FAILURES = 3;
const GRACEFUL_SHUTDOWN_MS = 5_000;

// ── BackendManager ───────────────────────────────────────────────

export class BackendManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private status: BackendStatus = "stopped";
  private port: number = DEFAULT_PORT;
  private pid: number | null = null;
  private startTime: number | null = null;

  // Startup health check
  private startupHealthTimer: ReturnType<typeof setTimeout> | null = null;
  private startupHealthStart: number = 0;

  // Runtime health check
  private runtimeHealthTimer: ReturnType<typeof setInterval> | null = null;
  private consecutiveHealthFailures: number = 0;

  private pythonExe: string;
  private backendCwd: string;
  private crashedCount: number = 0;
  private readonly maxCrashRetries: number = 3;

  constructor(pythonExe?: string, backendCwd?: string) {
    super();
    this.pythonExe = pythonExe || this.detectPython();
    this.backendCwd = backendCwd || this.detectBackendCwd();
  }

  // ── Public API ─────────────────────────────────────────────────

  getStatus(): BackendStatus {
    return this.status;
  }

  getPort(): number {
    return this.port;
  }

  getInfo(): BackendInfo {
    return {
      status: this.status,
      port: this.port,
      pid: this.pid,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      startTime: this.startTime,
      consecutiveHealthFailures: this.consecutiveHealthFailures,
    };
  }

  /**
   * Start the Python backend.
   * Resolves when /health returns 200.
   * Rejects if health check times out or the process exits during startup.
   */
  async start(): Promise<void> {
    if (this.status === "running") {
      console.log("[backend] Already running, skipping.");
      return;
    }

    if (this.status === "starting") {
      console.log("[backend] Already starting, waiting...");
      // Wait for the current start attempt to finish
      return new Promise((resolve, reject) => {
        const onStatus = (newStatus: BackendStatus) => {
          if (newStatus === "running") {
            this.off("status-changed", onStatus);
            resolve();
          } else if (newStatus === "error" || newStatus === "stopped") {
            this.off("status-changed", onStatus);
            reject(new Error("Backend failed to start"));
          }
        };
        this.on("status-changed", onStatus);
      });
    }

    if (this.status === "stopping") {
      console.log("[backend] Currently stopping, waiting for stop to complete...");
      return new Promise((resolve, reject) => {
        const onStatus = (newStatus: BackendStatus) => {
          if (newStatus === "stopped") {
            this.off("status-changed", onStatus);
            // Now proceed with start
            this.start().then(resolve).catch(reject);
          } else if (newStatus === "error") {
            this.off("status-changed", onStatus);
            reject(new Error("Backend entered error state during stop"));
          }
        };
        this.on("status-changed", onStatus);
      });
    }

    this.setStatus("starting");

    // Find an available port
    const portResult = await this.findAvailablePort(DEFAULT_PORT);
    if (portResult === null) {
      this.setStatus("error");
      this.emit("port-exhausted");
      throw new Error("No available port");
    }
    this.port = portResult;

    const args = [
      "-m", "uvicorn",
      "src.main:app",
      "--host", "0.0.0.0",
      "--port", String(this.port),
    ];

    console.log(`[backend] Starting: ${this.pythonExe} ${args.join(" ")}`);
    console.log(`[backend] Working directory: ${this.backendCwd}`);
    console.log(`[backend] Port: ${this.port}`);

    try {
      this.process = spawn(this.pythonExe, args, {
        cwd: this.backendCwd,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1",
          CLI_PROXY_API_KEYS: process.env.CLI_PROXY_API_KEYS || "",
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      this.pid = this.process.pid || null;
      console.log(`[backend] Process spawned, PID: ${this.pid}`);

      // ── stdout / stderr forwarding ──
      this.process.stdout?.on("data", (data: Buffer) => {
        const lines = data.toString("utf-8").split("\n").filter((l) => l.trim());
        for (const line of lines) {
          console.log(`[python:out] ${line}`);
          this.emit("stdout", line);
        }
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        const lines = data.toString("utf-8").split("\n").filter((l) => l.trim());
        for (const line of lines) {
          // uvicorn logs INFO-level messages to stderr — don't treat as errors
          const severity = line.includes("ERROR") || line.includes("Traceback") ? "ERROR"
            : line.includes("WARNING") ? "WARN" : "INFO";
          console.error(`[python:${severity.toLowerCase()}] ${line}`);
          this.emit("stderr", line);
        }
      });

      // ── Process exit handler ──
      this.process.on("exit", (code, signal) => {
        console.log(`[backend] Process exited: code=${code} signal=${signal}`);
        this.clearStartupHealthPoll();
        this.clearRuntimeHealthCheck();

        if (this.status === "starting") {
          this.crashedCount++;
          if (this.crashedCount <= this.maxCrashRetries) {
            const delay = Math.pow(2, this.crashedCount - 1) * 1000;
            console.log(`[backend] Startup crash (attempt ${this.crashedCount}/${this.maxCrashRetries}). Retrying in ${delay}ms...`);
            setTimeout(() => this.start().catch(() => {}), delay);
          } else {
            console.error(`[backend] Max crash retries (${this.maxCrashRetries}) exceeded during startup.`);
            this.setStatus("error");
            this.emit("crash-exhausted");
          }
          return;
        }

        if (this.status === "running") {
          this.crashedCount++;
          if (this.crashedCount <= this.maxCrashRetries) {
            const delay = Math.pow(2, this.crashedCount - 1) * 1000;
            console.log(`[backend] Runtime crash (attempt ${this.crashedCount}/${this.maxCrashRetries}). Restarting in ${delay}ms...`);
            this.setStatus("starting");
            setTimeout(() => this.start().catch(() => {}), delay);
          } else {
            console.error(`[backend] Max crash retries (${this.maxCrashRetries}) exceeded. Backend stopped.`);
            this.setStatus("error");
            this.emit("crash-exhausted");
          }
          return;
        }

        // If stopping, do nothing special — process exited as expected
      });

      this.process.on("error", (err) => {
        console.error(`[backend] Spawn error: ${err.message}`);
        if (this.status === "starting") {
          this.setStatus("error");
        }
      });

      // ── Startup health check polling ──
      await this.waitForHealthy();

    } catch (err: any) {
      console.error(`[backend] Failed to start: ${err.message}`);
      if ((this.status as BackendStatus) !== "running") {
        this.setStatus("error");
      }
      throw err;
    }
  }

  /**
   * Stop the backend gracefully (SIGTERM → wait → SIGKILL).
   */
  async stop(): Promise<void> {
    if (!this.process || this.status === "stopped" || this.status === "stopping") {
      console.log("[backend] Not running or already stopping, nothing to do.");
      return;
    }

    this.setStatus("stopping");
    this.clearStartupHealthPoll();
    this.clearRuntimeHealthCheck();

    console.log(`[backend] Sending SIGTERM to PID ${this.pid}...`);
    const killed = this.process.kill("SIGTERM");

    if (!killed) {
      console.warn("[backend] SIGTERM failed, sending SIGKILL...");
      this.process.kill("SIGKILL");
    }

    // Wait for graceful shutdown, force kill on timeout
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (this.process && !this.process.killed) {
          console.warn("[backend] Graceful shutdown timed out, sending SIGKILL...");
          this.process.kill("SIGKILL");
        }
        resolve();
      }, GRACEFUL_SHUTDOWN_MS);

      this.process?.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.process = null;
    this.pid = null;
    this.startTime = null;
    this.crashedCount = 0;
    this.consecutiveHealthFailures = 0;
    this.setStatus("stopped");
    console.log("[backend] Stopped.");
  }

  /**
   * Restart the backend: stop → wait → start.
   */
  async restart(): Promise<void> {
    console.log("[backend] Restarting...");
    await this.stop();
    // Small delay to ensure port is fully released
    await new Promise((r) => setTimeout(r, 500));
    await this.start();
  }

  // ── Startup Health Check (fast poll, 500ms) ────────────────────

  private waitForHealthy(): Promise<void> {
    this.startupHealthStart = Date.now();

    return new Promise((resolve, reject) => {
      const poll = () => {
        if (Date.now() - this.startupHealthStart > STARTUP_HEALTH_TIMEOUT_MS) {
          this.clearStartupHealthPoll();
          reject(new Error(`Health check timed out after ${STARTUP_HEALTH_TIMEOUT_MS}ms`));
          return;
        }

        if (!this.process || this.process.killed) {
          this.clearStartupHealthPoll();
          reject(new Error("Process exited before becoming healthy"));
          return;
        }

        this.checkHealth()
          .then((healthy) => {
            if (healthy) {
              this.clearStartupHealthPoll();
              this.crashedCount = 0;
              this.consecutiveHealthFailures = 0;
              this.startTime = Date.now();
              this.startRuntimeHealthCheck();
              this.setStatus("running");
              console.log(`[backend] Healthy! Ready at http://localhost:${this.port}`);
              resolve();
            } else {
              this.startupHealthTimer = setTimeout(poll, STARTUP_HEALTH_INTERVAL_MS);
            }
          })
          .catch(() => {
            this.startupHealthTimer = setTimeout(poll, STARTUP_HEALTH_INTERVAL_MS);
          });
      };

      poll();
    });
  }

  private clearStartupHealthPoll(): void {
    if (this.startupHealthTimer) {
      clearTimeout(this.startupHealthTimer);
      this.startupHealthTimer = null;
    }
  }

  // ── Runtime Health Check (interval, 5s) ────────────────────────

  private startRuntimeHealthCheck(): void {
    this.clearRuntimeHealthCheck();
    console.log(`[backend] Starting runtime health check (every ${RUNTIME_HEALTH_INTERVAL_MS}ms, max ${MAX_CONSECUTIVE_HEALTH_FAILURES} consecutive failures)`);

    this.runtimeHealthTimer = setInterval(() => {
      this.checkHealth()
        .then((healthy) => {
          if (healthy) {
            // Reset failure counter on any success
            if (this.consecutiveHealthFailures > 0) {
              console.log(`[backend] Health check recovered after ${this.consecutiveHealthFailures} failures.`);
            }
            this.consecutiveHealthFailures = 0;
          } else {
            this.consecutiveHealthFailures++;
            console.warn(`[backend] Health check failed (${this.consecutiveHealthFailures}/${MAX_CONSECUTIVE_HEALTH_FAILURES})`);

            if (this.consecutiveHealthFailures >= MAX_CONSECUTIVE_HEALTH_FAILURES) {
              console.error(`[backend] ${MAX_CONSECUTIVE_HEALTH_FAILURES} consecutive health failures. Triggering restart...`);
              this.clearRuntimeHealthCheck();
              // Restart in background (don't await — the interval is fire-and-forget)
              this.restart().catch((e) => {
                console.error(`[backend] Health-triggered restart failed: ${e.message}. Entering error state.`);
                this.setStatus("error");
                this.clearRuntimeHealthCheck();
                this.startRuntimeHealthCheck();
              });
            }
          }
        })
        .catch((err) => {
          this.consecutiveHealthFailures++;
          console.warn(`[backend] Health check error (${this.consecutiveHealthFailures}/${MAX_CONSECUTIVE_HEALTH_FAILURES}): ${err.message}`);

          if (this.consecutiveHealthFailures >= MAX_CONSECUTIVE_HEALTH_FAILURES) {
            console.error(`[backend] ${MAX_CONSECUTIVE_HEALTH_FAILURES} consecutive health errors. Triggering restart...`);
            this.clearRuntimeHealthCheck();
            this.restart().catch((e) => {
              console.error(`[backend] Health-triggered restart failed: ${e.message}. Entering error state.`);
              this.setStatus("error");
              this.clearRuntimeHealthCheck();
              this.startRuntimeHealthCheck();
            });
          }
        });
    }, RUNTIME_HEALTH_INTERVAL_MS);
  }

  private clearRuntimeHealthCheck(): void {
    if (this.runtimeHealthTimer) {
      clearInterval(this.runtimeHealthTimer);
      this.runtimeHealthTimer = null;
    }
  }

  // ── Low-level Health Request ───────────────────────────────────

  private checkHealth(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(
        `http://127.0.0.1:${this.port}/health`,
        { timeout: 2000 },
        (res) => {
          let body = "";
          res.on("data", (chunk: Buffer) => (body += chunk.toString()));
          res.on("end", () => {
            try {
              const json = JSON.parse(body);
              resolve(json.status === "ok");
            } catch {
              resolve(false);
            }
          });
        }
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  // ── Port Detection ─────────────────────────────────────────────

  /**
   * Find an available port starting from `startPort`.
   * Returns the port number, or null if the entire range is exhausted.
   */
  private findAvailablePort(startPort: number): Promise<number | null> {
    const net = require("net");
    return new Promise((resolve) => {
      const tryPort = (port: number): void => {
        if (port > PORT_RANGE_END) {
          console.error(`[backend] All ports ${PORT_RANGE_START}-${PORT_RANGE_END} are in use.`);
          resolve(null);
          return;
        }
        const tester = net.createServer();
        let settled = false;
        tester.once("error", () => {
          if (settled) return;
          settled = true;
          tester.removeAllListeners();
          tester.close();
          tryPort(port + 1);
        });
        // Bind to 0.0.0.0 to match uvicorn's bind address (avoids Windows SO_REUSEADDR false-positive)
        tester.listen(port, "0.0.0.0", () => {
          if (settled) return;
          settled = true;
          tester.close(() => resolve(port));
        });
      };
      tryPort(startPort);
    });
  }

  // ── Path Detection ─────────────────────────────────────────────

  private detectPython(): string {
    const pythonExeName = process.platform === "win32" ? "python.exe" : "bin/python3";

    // Packaged app: use process.resourcesPath (path outside asar)
    const packagedPath = path.join(process.resourcesPath, "python", pythonExeName);
    if (fs.existsSync(packagedPath)) {
      console.log(`[backend] Using bundled Python: ${packagedPath}`);
      return packagedPath;
    }

    // Dev mode: relative path from dist/main/ to desktop/resources/python/
    const devPath = path.join(
      __dirname, "..", "..", "resources", "python", pythonExeName
    );
    if (fs.existsSync(devPath)) {
      console.log(`[backend] Using bundled Python (dev): ${devPath}`);
      return devPath;
    }

    const sysPython = process.platform === "win32" ? "python" : "python3";
    console.log(`[backend] Bundled Python not found, using system: ${sysPython}`);
    return sysPython;
  }

  private detectBackendCwd(): string {
    // Packaged app: backend source at resources/backend/
    const packagedPath = path.join(process.resourcesPath, "backend");
    if (fs.existsSync(packagedPath)) {
      console.log(`[backend] Using bundled backend: ${packagedPath}`);
      return packagedPath;
    }

    // Dev mode: relative path from dist/main/ to desktop/resources/backend/
    const devPath = path.join(__dirname, "..", "..", "resources", "backend");
    if (fs.existsSync(devPath)) {
      console.log(`[backend] Using bundled backend (dev): ${devPath}`);
      return devPath;
    }

    // Fallback: project root (dev mode without resources/backend)
    const projectRoot = path.join(__dirname, "..", "..", "..");
    console.log(`[backend] Bundled backend not found, using project root: ${projectRoot}`);
    return projectRoot;
  }

  // ── Internal ───────────────────────────────────────────────────

  private setStatus(newStatus: BackendStatus): void {
    const old = this.status;
    this.status = newStatus;
    console.log(`[backend] Status: ${old} → ${newStatus}`);
    this.emit("status-changed", newStatus, old);
  }
}
