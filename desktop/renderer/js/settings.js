/**
 * settings.js — Settings page with full configuration form.
 *
 * Features:
 *   - Proxy service: port, listen address
 *   - Startup behavior: auto-launch, tray minimize, start minimized
 *   - Appearance: theme (system/dark/light), language (zh-CN/en)
 *   - Data management: log retention days, export/import config
 *   - About: version display, check for updates
 *   - Lazy initialization via MutationObserver
 */

let isSettingsRendered = false;

// ── Render ─────────────────────────────────────────────────────────

function renderSettingsPage() {
  const container = document.getElementById("tab-settings");
  if (!container) return;

  container.innerHTML =
    '<h2 class="mb-3">设置</h2>' +

    '<!-- 代理服务 -->' +
    '<div class="card settings-section">' +
      '<h4>代理服务</h4>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px" class="mt-3">' +
        '<div class="form-group">' +
          '<label class="form-label">监听端口</label>' +
          '<input class="form-input" id="setting-port" type="number" value="8317" min="1024" max="65535">' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">监听地址</label>' +
          '<select class="form-select" id="setting-host">' +
            '<option value="0.0.0.0">0.0.0.0 (所有网络)</option>' +
            '<option value="127.0.0.1">127.0.0.1 (仅本地)</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<!-- 启动行为 -->' +
    '<div class="card settings-section">' +
      '<h4>启动行为</h4>' +
      toggleRow("setting-autolaunch", "开机自启", "系统启动时自动运行 cli-proxy") +
      toggleRow("setting-tray-minimize", "最小化到托盘", "关闭窗口时隐藏到系统托盘而非退出") +
      toggleRow("setting-start-minimized", "启动时最小化", "开机启动后不显示主窗口") +
    '</div>' +

    '<!-- 外观 -->' +
    '<div class="card settings-section">' +
      '<h4>外观</h4>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px" class="mt-3">' +
        '<div class="form-group">' +
          '<label class="form-label">主题</label>' +
          '<select class="form-select" id="setting-theme">' +
            '<option value="system">跟随系统</option>' +
            '<option value="dark">暗色</option>' +
            '<option value="light">亮色</option>' +
          '</select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">语言</label>' +
          '<select class="form-select" id="setting-lang">' +
            '<option value="zh-CN">中文</option>' +
            '<option value="en">English</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<!-- 数据管理 -->' +
    '<div class="card settings-section">' +
      '<h4>数据管理</h4>' +
      '<div class="form-group" style="max-width:120px">' +
        '<label class="form-label">日志保留天数</label>' +
        '<input class="form-input" id="setting-log-retention" type="number" value="30" min="1" max="365">' +
      '</div>' +
      '<div style="display:flex;gap:8px" class="mt-3">' +
        '<button class="btn" id="btn-export-config">导出配置</button>' +
        '<button class="btn" id="btn-import-config">导入配置</button>' +
      '</div>' +
    '</div>' +

    '<!-- 关于 -->' +
    '<div class="card settings-section">' +
      '<h4>关于</h4>' +
      '<div class="mt-3">' +
        '<div>版本: <strong id="setting-version">—</strong></div>' +
        '<div class="mt-2">' +
          '<button class="btn btn-sm" id="btn-check-update">检查更新</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  bindSettingsEvents();
  loadSettingsValues();
  isSettingsRendered = true;
}

function toggleRow(id, label, desc) {
  return '<div class="flex-between" style="padding:8px 0">' +
    '<div>' +
      '<strong>' + label + '</strong>' +
      '<div class="text-muted">' + desc + '</div>' +
    '</div>' +
    '<label class="toggle">' +
      '<input type="checkbox" id="' + id + '">' +
      '<span class="slider"></span>' +
    '</label>' +
    '</div>';
}

// ── Event Binding ──────────────────────────────────────────────────

function bindSettingsEvents() {
  // Auto-save on change
  const portEl = document.getElementById("setting-port");
  if (portEl) portEl.addEventListener("change", saveSettings);
  const hostEl = document.getElementById("setting-host");
  if (hostEl) hostEl.addEventListener("change", saveSettings);

  // Theme: apply immediately
  const themeEl = document.getElementById("setting-theme");
  if (themeEl) {
    themeEl.addEventListener("change", function () {
      applyTheme(themeEl.value);
      saveSettings();
    });
  }

  const langEl = document.getElementById("setting-lang");
  if (langEl) langEl.addEventListener("change", saveSettings);
  const retentionEl = document.getElementById("setting-log-retention");
  if (retentionEl) retentionEl.addEventListener("change", saveSettings);

  // Auto-launch toggle
  const autolaunchEl = document.getElementById("setting-autolaunch");
  if (autolaunchEl) {
    autolaunchEl.addEventListener("change", function () {
      toggleAutoLaunch(autolaunchEl.checked);
      saveSettings();
    });
  }

  const startMinEl = document.getElementById("setting-start-minimized");
  if (startMinEl) startMinEl.addEventListener("change", saveSettings);

  // Export config
  const exportBtn = document.getElementById("btn-export-config");
  if (exportBtn) exportBtn.addEventListener("click", exportConfig);

  // Import config
  const importBtn = document.getElementById("btn-import-config");
  if (importBtn) importBtn.addEventListener("click", importConfig);

  // Check update
  const updateBtn = document.getElementById("btn-check-update");
  if (updateBtn) {
    updateBtn.addEventListener("click", function () {
      if (window.electronAPI && window.electronAPI.checkUpdate) {
        window.electronAPI.checkUpdate();
      }
    });
  }
}

// ── Settings Loading ───────────────────────────────────────────────

async function loadSettingsValues() {
  // Set theme from localStorage first (immediate visual update)
  const savedTheme = localStorage.getItem("cli-proxy-theme") || "system";
  setVal("setting-theme", savedTheme);
  applyTheme(savedTheme);

  const savedLang = localStorage.getItem("cli-proxy-lang") || "zh-CN";
  setVal("setting-lang", savedLang);

  if (!window.electronAPI) return;

  try {
    const config = await window.electronAPI.getConfig();
    if (config && config.server) {
      setVal("setting-port", config.server.port || 8317);
      setVal("setting-host", config.server.host || "0.0.0.0");
    }

    setVal("setting-log-retention", 30);

    // Auto-launch
    if (window.electronAPI.getAutoLaunch) {
      const autoLaunch = await window.electronAPI.getAutoLaunch();
      setChecked("setting-autolaunch", !!autoLaunch);
    }

    setChecked("setting-tray-minimize", true);
    setChecked("setting-start-minimized", false);

    // Version
    let version = "1.0.0";
    if (window.electronAPI.getVersion) {
      version = await window.electronAPI.getVersion();
    }
    const verEl = document.getElementById("setting-version");
    if (verEl) verEl.textContent = version;
  } catch (e) {
    console.error("[settings] Failed to load settings:", e);
  }
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function setChecked(id, val) {
  const el = document.getElementById(id);
  if (el) el.checked = !!val;
}

// ── Save Settings ──────────────────────────────────────────────────

async function saveSettings() {
  if (!window.electronAPI) return;

  try {
    const config = await window.electronAPI.getConfig();
    if (!config.server) config.server = {};

    config.server.port = parseInt(document.getElementById("setting-port").value || "8317", 10);
    config.server.host = document.getElementById("setting-host").value || "0.0.0.0";

    // Store UI-only preferences in localStorage
    const themeEl = document.getElementById("setting-theme");
    if (themeEl) localStorage.setItem("cli-proxy-theme", themeEl.value);
    const langEl = document.getElementById("setting-lang");
    if (langEl) localStorage.setItem("cli-proxy-lang", langEl.value);

    await window.electronAPI.updateConfig(config);
  } catch (e) {
    console.error("[settings] Failed to save settings:", e);
  }
}

// ── Auto Launch ────────────────────────────────────────────────────

async function toggleAutoLaunch(enabled) {
  if (!window.electronAPI) return;
  try {
    if (window.electronAPI.setAutoLaunch) {
      await window.electronAPI.setAutoLaunch(enabled);
    }
  } catch (e) {
    console.error("[settings] Failed to toggle auto-launch:", e);
  }
}

// ── Theme ──────────────────────────────────────────────────────────

function applyTheme(theme) {
  if (theme === "dark") {
    document.documentElement.removeAttribute("data-theme");
  } else if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    // Follow system
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (prefersDark) {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", "light");
    }
  }
}

// Listen for system theme changes when in "system" mode
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
  const themeEl = document.getElementById("setting-theme");
  if (themeEl && themeEl.value === "system") {
    applyTheme("system");
  }
});

// ── Config Export / Import ─────────────────────────────────────────

async function exportConfig() {
  if (!window.electronAPI) return;
  try {
    const config = await window.electronAPI.getConfig();
    // Sanitize API keys before export to prevent credential leakage
    const safe = JSON.parse(JSON.stringify(config));
    if (safe.deepseek && safe.deepseek.api_keys) {
      safe.deepseek.api_keys = safe.deepseek.api_keys.map(function() { return "***"; });
    }
    if (safe.providers) {
      Object.keys(safe.providers).forEach(function(k) {
        if (safe.providers[k].api_keys) {
          safe.providers[k].api_keys = safe.providers[k].api_keys.map(function() { return "***"; });
        }
      });
    }
    const json = JSON.stringify(safe, null, 2);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cli-proxy-config.json";
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert("导出失败: " + (e.message || "未知错误"));
  }
}

function importConfig() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,.yaml,.yml";

  input.onchange = function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function () {
      try {
        const text = reader.result;
        let config;

        // Try JSON first
        try {
          config = JSON.parse(text);
        } catch (jsonErr) {
          // Simple YAML-like detection (for basic config format)
          alert("JSON 格式解析失败。请确保文件为有效的 JSON 格式。\n\n对于 YAML 格式，请手动将 config.yaml 复制到对应目录。");
          return;
        }

        if (!window.electronAPI) return;
        await window.electronAPI.updateConfig(config);
        alert("配置已导入，代理将自动重启以应用新配置。");
        loadSettingsValues();
      } catch (err) {
        alert("导入失败: " + (err.message || "未知错误"));
      }
    };
    reader.readAsText(file);
  };

  input.click();
}

// ── Lazy Init ──────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", function () {
  initLazyTab("settings", renderSettingsPage, function () { return isSettingsRendered; });
});
