/**
 * logs.js — Real-time logs + audit log viewer.
 *
 * Features:
 *   - Real-time log stream with filter (ALL/INFO/WARN/ERROR) and search
 *   - Pause/resume, clear, export buttons
 *   - Ring buffer (max 5000 entries), renders last 200 visible
 *   - Audit log section with date selector and table
 *   - Status-colored badges (completed/cache_hit = green, error = red)
 *   - Lazy initialization via MutationObserver
 */

// ── Log Buffer ─────────────────────────────────────────────────────

const MAX_LOG_LINES = 5000;
let logBuffer = [];
let logFilter = "ALL"; // ALL | INFO | WARN | ERROR
let logSearch = "";
let logPaused = false;
let isLogRendered = false;

// ── Render ─────────────────────────────────────────────────────────

function renderLogsPage() {
  const container = document.getElementById("tab-logs");
  if (!container) return;

  container.innerHTML =
    '<!-- 实时日志工具栏 -->' +
    '<div class="flex-between mb-3">' +
      '<h2>实时日志</h2>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
        '<input class="form-input" id="log-search" placeholder="搜索关键词..." style="width:160px">' +
        '<select class="form-select" id="log-filter" style="width:90px">' +
          '<option value="ALL">全部</option>' +
          '<option value="INFO">INFO</option>' +
          '<option value="WARN">WARN</option>' +
          '<option value="ERROR">ERROR</option>' +
        '</select>' +
        '<button class="btn btn-sm" id="btn-log-pause">暂停</button>' +
        '<button class="btn btn-sm" id="btn-log-clear">清空</button>' +
        '<button class="btn btn-sm" id="btn-log-export">导出</button>' +
      '</div>' +
    '</div>' +
    '<!-- 日志查看器 -->' +
    '<div class="log-container" id="log-viewer">' +
      '<div class="text-muted" style="padding:12px">等待日志...</div>' +
    '</div>' +
    '<div class="text-muted mt-2" id="log-count">共 0 条</div>' +

    '<!-- 审计日志 -->' +
    '<hr class="mt-3 mb-3">' +
    '<div class="flex-between mb-3">' +
      '<h3>审计日志</h3>' +
      '<select class="form-select" id="audit-date-select" style="width:140px"></select>' +
    '</div>' +
    '<div class="audit-table-wrapper">' +
      '<table>' +
        '<thead><tr>' +
          '<th>时间</th><th>Trace ID</th><th>模型</th><th>供应商</th><th>流式</th><th>耗时</th><th>状态</th>' +
        '</tr></thead>' +
        '<tbody id="audit-tbody">' +
          '<tr><td colspan="7" class="text-muted">选择日期加载审计日志...</td></tr>' +
        '</tbody>' +
      '</table>' +
    '</div>';

  bindLogEvents();
  refreshLogView();
  loadAuditDates();
  isLogRendered = true;
}

// ── Log Events ─────────────────────────────────────────────────────

function bindLogEvents() {
  // Level filter
  const filterEl = document.getElementById("log-filter");
  if (filterEl) {
    filterEl.addEventListener("change", function () {
      logFilter = filterEl.value;
      refreshLogView();
    });
  }

  // Search
  const searchEl = document.getElementById("log-search");
  if (searchEl) {
    searchEl.addEventListener("input", function () {
      logSearch = searchEl.value.toLowerCase();
      refreshLogView();
    });
  }

  // Pause / Resume
  const pauseBtn = document.getElementById("btn-log-pause");
  if (pauseBtn) {
    pauseBtn.addEventListener("click", function () {
      logPaused = !logPaused;
      pauseBtn.textContent = logPaused ? "继续" : "暂停";
    });
  }

  // Clear
  const clearBtn = document.getElementById("btn-log-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      logBuffer = [];
      refreshLogView();
    });
  }

  // Export
  const exportBtn = document.getElementById("btn-log-export");
  if (exportBtn) {
    exportBtn.addEventListener("click", function () {
      const text = logBuffer.map(function (l) {
        return "[" + (l.timestamp || "") + "] [" + (l.level || "") + "] " + (l.message || "");
      }).join("\n");
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cli-proxy-logs.txt";
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // Audit date change
  const dateSelect = document.getElementById("audit-date-select");
  if (dateSelect) {
    dateSelect.addEventListener("change", function () {
      loadAuditEntries(dateSelect.value);
    });
  }
}

// ── Log View Refresh ───────────────────────────────────────────────

function refreshLogView() {
  const viewer = document.getElementById("log-viewer");
  if (!viewer) return;

  let lines = logBuffer;
  if (logFilter !== "ALL") {
    lines = lines.filter(function (l) { return l.level === logFilter; });
  }
  if (logSearch) {
    lines = lines.filter(function (l) { return l.message && l.message.toLowerCase().indexOf(logSearch) !== -1; });
  }

  const countEl = document.getElementById("log-count");
  if (countEl) {
    countEl.textContent = "共 " + lines.length + " 条" + (logBuffer.length >= MAX_LOG_LINES ? " (已达上限)" : "");
  }

  if (lines.length === 0) {
    viewer.innerHTML = '<div class="text-muted" style="padding:12px">无匹配日志</div>';
    return;
  }

  // Render only last 200 visible lines for performance
  const visible = lines.slice(-200);
  viewer.innerHTML = visible.map(function (l) {
    return '<div class="log-line ' + (l.level || "INFO") + '">' +
      '<span class="text-muted">' + formatTime(l.timestamp) + '</span> ' +
      escapeHtmlLog(l.message) +
      '</div>';
  }).join("");

  // Auto-scroll to bottom
  viewer.scrollTop = viewer.scrollHeight;
}

function escapeHtmlLog(s) {
  if (!s) return "";
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ── Log Entry Handler ──────────────────────────────────────────────

window.addEventListener("log:entry", function (e) {
  if (logPaused) {
    // Still buffer but don't render
    logBuffer.push(e.detail);
    if (logBuffer.length > MAX_LOG_LINES) {
      logBuffer = logBuffer.slice(-MAX_LOG_LINES);
    }
    return;
  }

  logBuffer.push(e.detail);
  if (logBuffer.length > MAX_LOG_LINES) {
    logBuffer = logBuffer.slice(-MAX_LOG_LINES);
  }

  if (isLogRendered) {
    refreshLogView();
  }
});

// ── Audit Log ──────────────────────────────────────────────────────

async function loadAuditDates() {
  if (!window.electronAPI) return;
  const select = document.getElementById("audit-date-select");
  if (!select) return;

  try {
    const dates = await window.electronAPI.getAuditDates();
    if (dates && dates.length > 0) {
      select.innerHTML = dates.map(function (d) {
        return '<option value="' + d + '">' + d + '</option>';
      }).join("");
      loadAuditEntries(dates[0]);
    } else {
      select.innerHTML = '<option value="">无数据</option>';
    }
  } catch (e) {
    console.error("[logs] Failed to load audit dates:", e);
  }
}

async function loadAuditEntries(date) {
  if (!window.electronAPI) return;
  const tbody = document.getElementById("audit-tbody");
  if (!tbody) return;

  try {
    const entries = await window.electronAPI.getAuditLogs(date);
    if (!entries || entries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-muted">当天无审计记录</td></tr>';
      return;
    }

    // Reverse to show newest first
    entries.reverse();

    tbody.innerHTML = entries.map(function (e) {
      const timeStr = e.timestamp ? new Date(e.timestamp).toLocaleTimeString("zh-CN", { hour12: false }) : "—";
      const traceId = e.trace_id ? e.trace_id.substring(0, 8) : "—";
      const model = e.model || "—";
      const provider = e.provider || "—";
      const streamLabel = e.stream ? "流式" : "非流式";
      const elapsed = (e.elapsed_ms != null) ? e.elapsed_ms + "ms" : "—";
      const status = e.status || "—";
      const badgeCls = (status === "completed" || status === "cache_hit") ? "badge-ok" : "badge-err";

      return '<tr>' +
        '<td>' + timeStr + '</td>' +
        '<td><code>' + escapeHtml(traceId) + '</code></td>' +
        '<td>' + escapeHtml(model) + '</td>' +
        '<td>' + escapeHtml(provider) + '</td>' +
        '<td>' + streamLabel + '</td>' +
        '<td>' + elapsed + '</td>' +
        '<td><span class="badge ' + badgeCls + '">' + escapeHtml(status) + '</span></td>' +
        '</tr>';
    }).join("");
  } catch (e) {
    console.error("[logs] Failed to load audit entries:", e);
    tbody.innerHTML = '<tr><td colspan="7" class="text-muted">加载失败</td></tr>';
  }
}

// ── Lazy Init ──────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", function () {
  initLazyTab("logs", renderLogsPage, function () { return isLogRendered; });
});
