/**
 * providers.js — Provider management panel (cc-switch style).
 *
 * Features:
 *   - Preset templates (DeepSeek, Qwen, Moonshot, Bailian, SiliconFlow)
 *   - Card grid with status badges, key masking, model maps
 *   - Edit modal (name, API base, keys textarea, model map JSON textarea)
 *   - CRUD: add / edit / delete / set default / test connection / copy key
 *   - Lazy initialization via MutationObserver on tab panel
 */

// ── Preset Templates ───────────────────────────────────────────────

const PRESETS = {
  deepseek: { name: "DeepSeek", api_base: "https://api.deepseek.com", default_model: "deepseek-v4-pro" },
  qwen:     { name: "Qwen (DashScope)", api_base: "https://dashscope.aliyuncs.com/compatible-mode", default_model: "qwen-max" },
  moonshot: { name: "Moonshot (Kimi)", api_base: "https://api.moonshot.cn", default_model: "moonshot-v1-auto" },
  bailian:  { name: "Bailian (百炼)", api_base: "https://dashscope.aliyuncs.com/compatible-mode", default_model: "qwen-max" },
  siliconflow: { name: "SiliconFlow", api_base: "https://api.siliconflow.cn", default_model: "deepseek-ai/DeepSeek-V3" },
};

// ── State ──────────────────────────────────────────────────────────

let providers = {};
const healthStatus = {}; // { providerName: { status: 'ok'|'warn'|'err', latency: number } }
let isProvidersRendered = false;

// ── Render ─────────────────────────────────────────────────────────

function renderProviders() {
  const container = document.getElementById("tab-providers");
  if (!container) return;

  loadProvidersData().then(function () {
    const entries = Object.entries(providers);
    const html = '<div class="flex-between mb-3">' +
      '<h2>供应商管理</h2>' +
      '<button class="btn btn-primary" id="btn-add-provider">+ 添加供应商</button>' +
      '</div>' +
      '<div class="card-grid">' +
      (entries.length > 0
        ? entries.map(function (entry) { return renderCard(entry[0], entry[1]); }).join("")
        : '<p class="text-muted">暂无供应商，点击"+ 添加供应商"开始配置</p>') +
      '</div>' +
      renderPresetModal() +
      renderEditModal();

    container.innerHTML = html;
    bindProviderEvents();
    isProvidersRendered = true;
  });
}

function renderCard(name, cfg) {
  const h = healthStatus[name] || {};
  const statusIcon = h.status === "ok" ? "●" : h.status === "warn" ? "●" : "●";
  const statusText = h.status === "ok" ? "正常" : h.status === "warn" ? "延迟高" : h.status === "err" ? "不可用" : "未知";
  const badgeCls = h.status === "ok" ? "badge-ok" : h.status === "warn" ? "badge-warn" : "badge-err";
  const latency = h.latency ? h.latency + "ms" : "—";
  const keyMask = cfg.api_keys && cfg.api_keys[0] ? cfg.api_keys[0].substring(0, 8) + "..." + cfg.api_keys[0].slice(-4) : "未配置";
  const models = cfg.model_map ? Object.entries(cfg.model_map).map(function (entry) { return entry[0] + " → " + entry[1]; }).join(", ") : "默认模型";
  const keyCount = cfg.api_keys ? cfg.api_keys.length : 0;

  return '<div class="card">' +
    '<div class="card-header">' +
      '<span class="card-title">' + escapeHtml(name) + '</span>' +
      '<span class="badge ' + badgeCls + '">' + statusIcon + ' ' + statusText + '</span>' +
    '</div>' +
    '<div class="card-body">' +
      '<div>API: ' + escapeHtml(cfg.api_base || "—") + ' &nbsp; ' + latency + '</div>' +
      '<div class="mt-2">Key: ' + keyMask + ' <button class="btn btn-sm" data-action="copy-key" data-provider="' + escapeHtml(name) + '">复制</button></div>' +
      '<div class="mt-2">模型: ' + escapeHtml(models) + '</div>' +
      '<div class="mt-2">状态: ● 活跃 (' + keyCount + ' Key 轮询中)</div>' +
    '</div>' +
    '<div class="card-actions">' +
      '<button class="btn btn-sm" data-action="set-default" data-provider="' + escapeHtml(name) + '">设为默认</button>' +
      '<button class="btn btn-sm" data-action="test" data-provider="' + escapeHtml(name) + '">测试连接</button>' +
      '<button class="btn btn-sm" data-action="edit" data-provider="' + escapeHtml(name) + '">编辑</button>' +
      (name !== "deepseek" ? '<button class="btn btn-sm btn-danger" data-action="delete" data-provider="' + escapeHtml(name) + '">删除</button>' : "") +
    '</div>' +
  '</div>';
}

function renderPresetModal() {
  const presetItems = Object.entries(PRESETS).map(function (entry) {
    const key = entry[0];
    const p = entry[1];
    return '<div class="card preset-card mb-3" data-preset="' + key + '" style="cursor:pointer">' +
      '<strong>' + p.name + '</strong>' +
      '<div class="text-muted">' + escapeHtml(p.api_base) + '</div>' +
      '</div>';
  }).join("");

  return '<div class="modal-overlay" id="modal-preset">' +
    '<div class="modal">' +
      '<h3>选择供应商模板</h3>' +
      presetItems +
      '<div class="text-muted mb-3" style="text-align:center">或</div>' +
      '<button class="btn btn-primary" data-preset="custom" style="width:100%">自定义供应商</button>' +
      '<div class="modal-actions">' +
        '<button class="btn" id="btn-preset-cancel">取消</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function renderEditModal() {
  return '<div class="modal-overlay" id="modal-edit">' +
    '<div class="modal">' +
      '<h3 id="edit-title">编辑供应商</h3>' +
      '<div class="form-group">' +
        '<label class="form-label">供应商名称</label>' +
        '<input class="form-input" id="edit-name" placeholder="my-provider">' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">API Base URL</label>' +
        '<input class="form-input" id="edit-api-base" placeholder="https://api.example.com">' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">API Keys (每行一个，支持轮询)</label>' +
        '<textarea class="form-input" id="edit-api-keys" rows="3" placeholder="sk-xxx"></textarea>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">模型映射 (JSON 格式，可选)</label>' +
        '<textarea class="form-input" id="edit-model-map" rows="3" placeholder=\'{"gpt-5.5": "my-model"}\'></textarea>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-danger" id="btn-edit-delete" style="display:none">删除</button>' +
        '<button class="btn" id="btn-edit-cancel">取消</button>' +
        '<button class="btn btn-primary" id="btn-edit-save">保存</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

// ── Event Binding ──────────────────────────────────────────────────

function bindProviderEvents() {
  // Add provider button
  const addBtn = document.getElementById("btn-add-provider");
  if (addBtn) {
    addBtn.addEventListener("click", function () {
      document.getElementById("modal-preset").classList.add("open");
    });
  }

  // Preset modal: cancel
  const presetCancel = document.getElementById("btn-preset-cancel");
  if (presetCancel) {
    presetCancel.addEventListener("click", function () {
      document.getElementById("modal-preset").classList.remove("open");
    });
  }

  // Preset modal: click preset or custom
  document.querySelectorAll("[data-preset]").forEach(function (el) {
    el.addEventListener("click", function () {
      openEditModal(el.dataset.preset);
    });
  });

  // Edit modal: cancel
  const editCancel = document.getElementById("btn-edit-cancel");
  if (editCancel) {
    editCancel.addEventListener("click", closeEditModal);
  }

  // Edit modal: save
  const editSave = document.getElementById("btn-edit-save");
  if (editSave) {
    editSave.addEventListener("click", saveProvider);
  }

  // Edit modal: delete button inside modal
  const editDelete = document.getElementById("btn-edit-delete");
  if (editDelete) {
    editDelete.addEventListener("click", function () {
      const name = document.getElementById("edit-name").dataset.original;
      if (!name || name === "deepseek") return;
      if (!confirm('确定删除供应商 "' + name + '"？')) return;
      deleteProviderByName(name);
    });
  }

  // Card action buttons
  document.querySelectorAll("[data-action]").forEach(function (el) {
    el.addEventListener("click", function () {
      const action = el.dataset.action;
      const name = el.dataset.provider;
      if (action === "edit") openEditModal(name);
      if (action === "test") testProvider(name);
      if (action === "set-default") setDefault(name);
      if (action === "delete") confirmDelete(name);
      if (action === "copy-key") copyKey(name);
    });
  });
}

// ── Data Loading ───────────────────────────────────────────────────

async function loadProvidersData() {
  if (!window.electronAPI) {
    // Fallback: use mock data
    providers = {
      deepseek: { api_base: "https://api.deepseek.com", api_keys: [], model_map: {} },
    };
    return;
  }
  try {
    const config = await window.electronAPI.getConfig();
    providers = { deepseek: config.deepseek || {}, };
    if (config.providers) {
      Object.keys(config.providers).forEach(function (key) {
        providers[key] = config.providers[key];
      });
    }
  } catch (e) {
    console.error("[providers] Failed to load config:", e);
    providers = {
      deepseek: {
        api_base: "https://api.deepseek.com",
        api_keys: [],
        model_map: {}
      }
    };
  }
}

// ── CRUD Operations ────────────────────────────────────────────────

function openEditModal(preset) {
  const modalPreset = document.getElementById("modal-preset");
  if (modalPreset) modalPreset.classList.remove("open");

  const isEdit = providers[preset];
  const p = isEdit ? providers[preset] : (PRESETS[preset] || { name: "", api_base: "", default_model: "" });

  document.getElementById("edit-title").textContent = isEdit ? "编辑供应商" : (p.name || "自定义供应商");
  document.getElementById("edit-name").value = isEdit ? preset : (preset === "custom" ? "" : preset);
  document.getElementById("edit-api-base").value = p.api_base || "";
  document.getElementById("edit-api-keys").value = isEdit ? (p.api_keys || []).join("\n") : "";

  let modelMapJson = "";
  if (isEdit && p.model_map) {
    try { modelMapJson = JSON.stringify(p.model_map, null, 2); } catch (e) { modelMapJson = ""; }
  } else if (p.default_model) {
    const defaultMap = {};
    defaultMap["gpt-5.5"] = p.default_model;
    try { modelMapJson = JSON.stringify(defaultMap, null, 2); } catch (e) { modelMapJson = ""; }
  }
  document.getElementById("edit-model-map").value = modelMapJson;

  document.getElementById("edit-name").dataset.original = preset;
  document.getElementById("btn-edit-delete").style.display = isEdit ? "" : "none";

  const modalEdit = document.getElementById("modal-edit");
  if (modalEdit) modalEdit.classList.add("open");
}

function closeEditModal() {
  const modal = document.getElementById("modal-edit");
  if (modal) modal.classList.remove("open");
}

async function saveProvider() {
  const name = document.getElementById("edit-name").value.trim();
  const apiBase = document.getElementById("edit-api-base").value.trim();
  const apiKeys = document.getElementById("edit-api-keys").value.split("\n").map(function (k) { return k.trim(); }).filter(function (k) { return k; });
  const modelMapStr = document.getElementById("edit-model-map").value.trim();
  let modelMap = {};
  if (modelMapStr) {
    try { modelMap = JSON.parse(modelMapStr); } catch (e) { modelMap = {}; }
  }

  if (!name || !apiBase) {
    alert("名称和 API Base URL 不能为空");
    return;
  }

  if (!window.electronAPI) return;

  try {
    const config = await window.electronAPI.getConfig();
    if (name === "deepseek") {
      config.deepseek.api_base = apiBase;
      config.deepseek.api_keys = apiKeys;
    } else {
      if (!config.providers) config.providers = {};
      config.providers[name] = {
        api_base: apiBase,
        api_keys: apiKeys,
        enabled: true,
        model_map: modelMap,
      };
    }
    await window.electronAPI.updateConfig(config);
    closeEditModal();
    renderProviders();
  } catch (e) {
    alert("保存失败: " + (e.message || "未知错误"));
  }
}

async function deleteProviderByName(name) {
  if (!window.electronAPI) return;
  try {
    const config = await window.electronAPI.getConfig();
    if (config.providers) delete config.providers[name];
    await window.electronAPI.updateConfig(config);
    closeEditModal();
    renderProviders();
  } catch (e) {
    alert("删除失败: " + (e.message || "未知错误"));
  }
}

function confirmDelete(name) {
  if (!confirm('确定删除供应商 "' + name + '"？此操作不可撤销。')) return;
  if (!window.electronAPI) return;
  window.electronAPI.getConfig().then(function (config) {
    if (config.providers) delete config.providers[name];
    return window.electronAPI.updateConfig(config);
  }).then(function () {
    renderProviders();
  }).catch(function (e) {
    alert("删除失败: " + (e.message || "未知错误"));
  });
}

async function setDefault(name) {
  if (!window.electronAPI) return;
  try {
    const config = await window.electronAPI.getConfig();
    if (!config.model_map) config.model_map = {};
    config.model_map["__default__"] = name;
    await window.electronAPI.updateConfig(config);
    alert('已将 "' + name + '" 设为默认供应商');
  } catch (e) {
    alert("操作失败: " + (e.message || "未知错误"));
  }
}

function copyKey(name) {
  const cfg = providers[name];
  const key = cfg && cfg.api_keys && cfg.api_keys[0] ? cfg.api_keys[0] : "";
  if (!key) {
    alert("该供应商未配置 API Key");
    return;
  }
  navigator.clipboard.writeText(key).then(function () {
    // Success — no alert needed
  }).catch(function () {
    alert("复制失败，请手动复制");
  });
}

async function testProvider(name) {
  const cfg = providers[name];
  const key = cfg && cfg.api_keys && cfg.api_keys[0] ? cfg.api_keys[0] : "";
  if (!key) {
    alert("请先配置 API Key");
    return;
  }
  if (!window.electronAPI) return;
  try {
    const result = await window.electronAPI.testProvider(name, key);
    if (result.success) {
      alert("连接成功！延迟: " + (result.latency || "?") + "ms");
    } else {
      alert("连接失败: " + (result.error || "未知错误"));
    }
  } catch (e) {
    alert("测试失败: " + (e.message || "未知错误"));
  }
}

// ── Lazy Init ──────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", function () {
  initLazyTab("providers", renderProviders, function () { return isProvidersRendered; });

  // Reload providers when backend status changes (config may have been reloaded)
  window.addEventListener("backend:status", function () {
    if (isProvidersRendered && document.getElementById("tab-providers").classList.contains("active")) {
      renderProviders();
    }
  });
});
