/**
 * app.js — Main renderer entry point.
 *
 * Handles:
 *   - Bottom Tab navigation
 *   - Title bar status display (dot + text + port)
 *   - IPC event listener registration
 *   - Global state shared across page modules
 */

// ── Global State ───────────────────────────────────────────────────

const state = {
  activeTab: "dashboard",
  backendStatus: "stopped",
  backendPort: null,
};

// ── Tab Navigation ─────────────────────────────────────────────────

function initTabNav() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (!tab) return;

      state.activeTab = tab;

      document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      document.getElementById("tab-" + tab)?.classList.add("active");
    });
  });
}

// ── Title Bar Status ───────────────────────────────────────────────

/**
 * Update the title bar dot color, status text, and port display.
 * @param {string} status - "running" | "stopped" | "starting" | "stopping" | "error"
 * @param {number|null} port
 */
function updateTitlebar(status, port) {
  const dot = document.getElementById("titlebar-dot");
  const text = document.getElementById("titlebar-status-text");
  const portEl = document.getElementById("titlebar-port");

  if (dot) {
    dot.className = "brand-dot";
    if (status === "running") dot.classList.add("running");
    if (status === "error") dot.classList.add("error");
    if (status === "starting" || status === "stopping") dot.classList.add(status);
  }

  const labels = {
    running: "运行中",
    stopped: "已停止",
    starting: "启动中...",
    stopping: "停止中...",
    error: "错误",
  };
  if (text) text.textContent = labels[status] || status;
  if (portEl) portEl.textContent = port ? "端口 " + port : "端口 —";
}

// ── IPC Init ───────────────────────────────────────────────────────

function initIPC() {
  if (!window.electronAPI) {
    console.warn("[app] electronAPI not available. Running outside Electron?");
    updateTitlebar("stopped", null);
    return;
  }

  // Backend status updates
  window.electronAPI.onBackendStatus((info) => {
    state.backendStatus = info.status;
    state.backendPort = info.port;
    updateTitlebar(info.status, info.port);
    window.dispatchEvent(new CustomEvent("backend:status", { detail: info }));
  });

  // Log entries from Python proxy stdout/stderr
  window.electronAPI.onLogEntry((entry) => {
    window.dispatchEvent(new CustomEvent("log:entry", { detail: entry }));
  });

  // Stats updates from StatsCollector
  window.electronAPI.onStatsUpdate((s) => {
    window._lastStats = s;
    window.dispatchEvent(new CustomEvent("stats:update", { detail: s }));
  });

  // Crash exhausted
  window.electronAPI.onCrashExhausted(() => {
    window.dispatchEvent(new CustomEvent("backend:crash-exhausted"));
  });

  // Port exhausted
  window.electronAPI.onPortExhausted(() => {
    window.dispatchEvent(new CustomEvent("backend:port-exhausted"));
  });

  // Fetch initial backend status
  window.electronAPI.getBackendStatus().then((info) => {
    state.backendStatus = info.status;
    state.backendPort = info.port;
    updateTitlebar(info.status, info.port);
    window.dispatchEvent(new CustomEvent("backend:status", { detail: info }));
  }).catch((err) => {
    console.error("[app] Failed to get initial backend status:", err);
  });
}

// ── Global Helpers ─────────────────────────────────────────────────

/**
 * Format milliseconds to a human-readable uptime string.
 * @param {number} ms
 * @returns {string}
 */
function formatUptime(ms) {
  if (!ms || ms <= 0) return "—";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return h + "h " + m + "m " + sec + "s";
  if (m > 0) return m + "m " + sec + "s";
  return sec + "s";
}

/**
 * Format a timestamp to HH:MM:SS.
 * @param {string|number} ts
 * @returns {string}
 */
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}

/**
 * Format a number with K/M suffix for display.
 * @param {number} n
 * @returns {string}
 */
function formatNumber(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

/**
 * Escape HTML entities in a string.
 * @param {string} s
 * @returns {string}
 */
function escapeHtml(s) {
  if (!s) return "";
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

/**
 * Trigger a file download in the browser.
 * @param {string} content - File content
 * @param {string} filename - Download filename
 * @param {string} mimeType - MIME type
 */
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Lazy Tab Init ──────────────────────────────────────────────────

/**
 * Generic lazy initialization helper for tab panels.
 * Observes class changes and renders the tab content the first time it becomes active.
 * @param {string} tabId - The tab identifier (e.g., "providers", "dashboard", "logs", "settings")
 * @param {Function} renderFn - The render function to call
 * @param {Function} isRenderedFn - Returns true if already rendered
 */
function initLazyTab(tabId, renderFn, isRenderedFn) {
  const tabPanel = document.getElementById("tab-" + tabId);
  if (!tabPanel) return;

  const observer = new MutationObserver(function () {
    if (tabPanel.classList.contains("active") && !isRenderedFn()) {
      renderFn();
      observer.disconnect();
    }
  });
  observer.observe(tabPanel, { attributes: true, attributeFilter: ["class"] });

  if (tabPanel.classList.contains("active")) {
    renderFn();
  }
}

// ── Bootstrap ──────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", function () {
  initTabNav();
  initIPC();
});
