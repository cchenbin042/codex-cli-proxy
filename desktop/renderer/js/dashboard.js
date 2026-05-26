/**
 * dashboard.js — Dashboard page with Hero cards + Chart.js charts.
 *
 * Features:
 *   - 3 Hero cards: Total Tokens (w/ cache hit rate), Provider Health, Avg Latency (w/ total requests)
 *   - Date filter buttons: Today / 7 days / 30 days
 *   - Chart.js line chart: request volume over time
 *   - Chart.js bar chart: provider latency comparison
 *   - Lazy initialization via MutationObserver
 */

let tokenChart = null;
let latencyChart = null;
let currentDays = 7;
let isDashboardRendered = false;

// ── Render ─────────────────────────────────────────────────────────

function renderDashboard() {
  const container = document.getElementById("tab-dashboard");
  if (!container) return;

  container.innerHTML =
    '<!-- Hero 卡片 -->' +
    '<div class="hero-row">' +
      '<div class="hero-card">' +
        '<div class="value" id="hero-tokens">—</div>' +
        '<div class="label">总 Token 用量</div>' +
        '<div class="text-muted" id="hero-cache-rate">缓存命中率 —</div>' +
      '</div>' +
      '<div class="hero-card">' +
        '<div class="value" id="hero-health">—</div>' +
        '<div class="label">供应商健康</div>' +
        '<div class="text-muted" id="hero-health-detail">正常 / 总数</div>' +
      '</div>' +
      '<div class="hero-card">' +
        '<div class="value" id="hero-latency">—</div>' +
        '<div class="label">平均延迟</div>' +
        '<div class="text-muted" id="hero-requests">总请求 —</div>' +
      '</div>' +
    '</div>' +

    '<!-- 日期筛选 -->' +
    '<div class="flex-between mb-3">' +
      '<h2>用量趋势</h2>' +
      '<div>' +
        '<button class="date-filter" data-days="1">今天</button> ' +
        '<button class="date-filter active" data-days="7">7天</button> ' +
        '<button class="date-filter" data-days="30">30天</button>' +
      '</div>' +
    '</div>' +

    '<!-- 图表区域 -->' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" class="chart-grid">' +
      '<div class="card">' +
        '<h4>请求量趋势</h4>' +
        '<canvas id="chart-tokens"></canvas>' +
      '</div>' +
      '<div class="card">' +
        '<h4>供应商延迟 (ms)</h4>' +
        '<canvas id="chart-latency"></canvas>' +
      '</div>' +
    '</div>';

  bindDashboardEvents();
  loadDashboardData(currentDays);
  isDashboardRendered = true;
}

// ── Event Binding ──────────────────────────────────────────────────

function bindDashboardEvents() {
  document.querySelectorAll(".date-filter").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".date-filter").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      currentDays = parseInt(btn.dataset.days) || 7;
      loadDashboardData(currentDays);
    });
  });

  // Handle chart-grid responsive (stack on mobile)
  const chartGrid = document.querySelector(".chart-grid");
  if (chartGrid && window.innerWidth <= 640) {
    chartGrid.style.gridTemplateColumns = "1fr";
  }
}

// ── Data Loading ───────────────────────────────────────────────────

async function loadDashboardData(days) {
  // Update hero cards from cached stats
  if (window._lastStats && window._lastStats.summary) {
    updateHeroCards(window._lastStats.summary);
  }

  if (!window.electronAPI) return;

  try {
    const dailyStats = await window.electronAPI.getDailyStats(days);
    if (dailyStats && dailyStats.length > 0) {
      renderTokenChart(dailyStats);
      renderLatencyChart(dailyStats);
    }
  } catch (e) {
    console.error("[dashboard] Failed to load daily stats:", e);
  }
}

// ── Hero Cards ─────────────────────────────────────────────────────

function updateHeroCards(summary) {
  const tokensEl = document.getElementById("hero-tokens");
  const cacheRateEl = document.getElementById("hero-cache-rate");
  const healthEl = document.getElementById("hero-health");
  const healthDetailEl = document.getElementById("hero-health-detail");
  const latencyEl = document.getElementById("hero-latency");
  const requestsEl = document.getElementById("hero-requests");

  if (tokensEl) tokensEl.textContent = formatNumber(summary.totalTokens || 0);
  if (cacheRateEl) cacheRateEl.textContent = "缓存命中率 " + (summary.cacheHitRate || 0) + "%";
  if (healthEl) healthEl.textContent = (summary.healthyProviders || 0) + "/" + (summary.totalProviders || 0);
  if (healthDetailEl) healthDetailEl.textContent = "正常 / 总数";
  if (latencyEl) {
    if (summary.avgLatencyMs) {
      latencyEl.textContent = summary.avgLatencyMs + "ms";
    } else {
      latencyEl.textContent = "—";
    }
  }
  if (requestsEl) requestsEl.textContent = "总请求 " + (summary.totalRequests || 0);
}

// ── Chart.js: Request Volume Line Chart ────────────────────────────

function renderTokenChart(dailyStats) {
  const canvas = document.getElementById("chart-tokens");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (tokenChart) tokenChart.destroy();

  // Reverse so youngest date is on the right, extract MM-DD labels
  const labels = dailyStats.map(function (d) { return d.date.slice(5); }).reverse();
  const data = dailyStats.map(function (d) { return d.totalRequests; }).reverse();

  tokenChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [{
        label: "请求数",
        data: data,
        borderColor: "#6c8cff",
        backgroundColor: "rgba(108, 140, 255, 0.1)",
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointHoverRadius: 5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: {
          ticks: { color: "#8b949e", font: { size: 10 } },
          grid: { color: "rgba(48, 54, 61, 0.5)" },
        },
        y: {
          ticks: { color: "#8b949e", font: { size: 10 } },
          grid: { color: "rgba(48, 54, 61, 0.5)" },
          beginAtZero: true,
        },
      },
    },
  });
}

// ── Chart.js: Provider Latency Bar Chart ──────────────────────────

function renderLatencyChart(dailyStats) {
  const canvas = document.getElementById("chart-latency");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (latencyChart) latencyChart.destroy();

  // Collect all unique provider names across all days
  const providersSet = {};
  dailyStats.forEach(function (d) {
    if (d.byProvider) {
      Object.keys(d.byProvider).forEach(function (p) { providersSet[p] = true; });
    }
  });
  const providerNames = Object.keys(providersSet);

  const colors = ["#6c8cff", "#34d399", "#fbbf24", "#f87171", "#a78bfa"];
  const datasets = providerNames.map(function (p, i) {
    return {
      label: p,
      data: dailyStats.map(function (d) {
        return Math.round((d.byProvider && d.byProvider[p] && d.byProvider[p].avgLatency) || 0);
      }).reverse(),
      backgroundColor: colors[i % colors.length],
    };
  });

  const labels = dailyStats.map(function (d) { return d.date.slice(5); }).reverse();

  latencyChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      scales: {
        x: {
          stacked: false,
          ticks: { color: "#8b949e", font: { size: 10 } },
          grid: { color: "rgba(48, 54, 61, 0.5)" },
        },
        y: {
          ticks: { color: "#8b949e", font: { size: 10 } },
          grid: { color: "rgba(48, 54, 61, 0.5)" },
          beginAtZero: true,
        },
      },
      plugins: {
        legend: {
          labels: {
            color: "#8b949e",
            font: { size: 10 },
            boxWidth: 12,
            padding: 10,
          },
        },
      },
    },
  });
}

// ── Event Listeners ────────────────────────────────────────────────

// Listen for stats:update from main process
window.addEventListener("stats:update", function (e) {
  window._lastStats = e.detail;
  if (e.detail && e.detail.summary) {
    updateHeroCards(e.detail.summary);
  }
  if (isDashboardRendered && currentDays) {
    loadDashboardData(currentDays);
  }
});

// ── Lazy Init ──────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", function () {
  initLazyTab("dashboard", renderDashboard, function () { return isDashboardRendered; });
});
