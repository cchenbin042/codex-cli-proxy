/**
 * stats-collector.ts — Incremental JSONL stats parser with in-memory aggregation.
 *
 * Scans audit_logs/ directory periodically (default 30s), tracks file offsets
 * to only parse new lines, and aggregates data into DailyStats by date.
 * Emits "update" events when new data is ingested so the renderer can stay live.
 */

import { promises as fsPromises } from "fs";
import * as path from "path";
import { EventEmitter } from "events";

// ── Types ──────────────────────────────────────────────────────────

export interface ProviderStats {
  requests: number;
  tokens: number;
  errors: number;
  avgLatency: number;
}

export interface ModelStats {
  requests: number;
  tokens: number;
  cacheHits: number;
}

export interface DailyStats {
  date: string;
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCacheHits: number;
  totalErrors: number;
  avgLatencyMs: number;
  byProvider: Record<string, ProviderStats>;
  byModel: Record<string, ModelStats>;
}

export interface StatsSummary {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  cacheHitRate: number;
  cacheHits: number;
  totalRequests: number;
  totalErrors: number;
  healthyProviders: number;
  totalProviders: number;
  avgLatencyMs: number;
  streamRatio: number;
}

// ── StatsCollector ─────────────────────────────────────────────────

export class StatsCollector extends EventEmitter {
  private auditDir: string;
  private fileOffsets: Map<string, number> = new Map();
  private dailyCache: Map<string, DailyStats> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;
  private scanning = false;
  private cacheEntriesCache: { model: string; requests: number; tokens: number; cacheHits: number }[] | null = null;
  private cacheDirty = true;

  constructor(auditDir: string, intervalMs = 30000) {
    super();
    this.auditDir = auditDir;
    this.intervalMs = intervalMs;
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  async start(): Promise<void> {
    await fsPromises.mkdir(this.auditDir, { recursive: true });
    // Initial scan to pick up any existing data
    this.scan();
    this.timer = setInterval(() => this.scan(), this.intervalMs);
    console.log(`[stats-collector] Started. Watching: ${this.auditDir} (every ${this.intervalMs}ms)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log("[stats-collector] Stopped.");
  }

  // ── Scanning ────────────────────────────────────────────────────

  private async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      let files: string[];
      try {
        files = (await fsPromises.readdir(this.auditDir))
          .filter((f) => f.endsWith(".jsonl"))
          .sort();
      } catch (e) {
        console.warn("[stats] Failed to read audit dir:", e);
        return;
      }

      let changed = false;

      for (const file of files) {
        const filePath = path.join(this.auditDir, file);
        const date = file.replace(".jsonl", "");
        let prevOffset = this.fileOffsets.get(file) || 0;

        try {
          const stat = await fsPromises.stat(filePath);
          // Detect truncation (log rotation): reset offset when file shrinks
          if (stat.size < prevOffset) {
            console.warn(`[stats] File ${file} appears truncated (size ${stat.size} < offset ${prevOffset}). Re-reading from start.`);
            this.fileOffsets.set(file, 0);
            prevOffset = 0;
          }
          if (stat.size <= prevOffset) continue;

          // Read only the new bytes since last offset
          const bytesToRead = stat.size - prevOffset;
          const fd = await fsPromises.open(filePath, "r");
          const { buffer } = await fd.read(Buffer.alloc(bytesToRead), 0, bytesToRead, prevOffset);
          await fd.close();

          const newData = buffer.toString("utf-8");
          const lines = newData.split("\n").filter((l) => l.trim());

          // Get or create the daily accumulator
          let daily = this.dailyCache.get(date);
          if (!daily) {
            daily = this.emptyDaily(date);
          }

          for (const line of lines) {
            try {
              const entry = JSON.parse(line);
              this.ingestEntry(daily, entry);
            } catch (e) {
              console.warn("[stats] Failed to parse audit line:", e);
              // Skip malformed / partial lines
            }
          }

          this.dailyCache.set(date, daily);
          this.fileOffsets.set(file, stat.size);
          changed = true;
        } catch {
          // File may have been deleted or rotated — skip
        }
      }

      if (changed) {
        // Prune dailyCache: keep only last 90 days
        if (this.dailyCache.size > 90) {
          const dates = Array.from(this.dailyCache.keys()).sort();
          while (dates.length > 90) {
            this.dailyCache.delete(dates.shift()!);
          }
        }

        this.cacheDirty = true;
        this.emit("update", this.getSummary(), Array.from(this.dailyCache.values()));
      }
    } finally {
      this.scanning = false;
    }
  }

  // ── Ingestion ───────────────────────────────────────────────────

  private ingestEntry(daily: DailyStats, entry: any): void {
    daily.totalRequests++;

    if (entry.status === "cache_hit") {
      daily.totalCacheHits++;
    } else if (entry.status !== "completed") {
      daily.totalErrors++;
    }

    // Token estimation: try entry.usage first, fall back to 0
    const promptTokens = entry.usage?.prompt_tokens || entry.prompt_tokens || 0;
    const completionTokens = entry.usage?.completion_tokens || entry.completion_tokens || 0;
    daily.totalPromptTokens += promptTokens;
    daily.totalCompletionTokens += completionTokens;

    // Rolling average latency
    const latency = entry.elapsed_ms || 0;
    if (daily.totalRequests > 1) {
      daily.avgLatencyMs =
        (daily.avgLatencyMs * (daily.totalRequests - 1) + latency) / daily.totalRequests;
    } else {
      daily.avgLatencyMs = latency;
    }

    // Per-provider aggregation
    const provider = entry.provider || "deepseek";
    if (!daily.byProvider[provider]) {
      daily.byProvider[provider] = { requests: 0, tokens: 0, errors: 0, avgLatency: 0 };
    }
    const ps = daily.byProvider[provider];
    ps.requests++;
    ps.tokens += promptTokens + completionTokens;
    if (entry.status !== "completed" && entry.status !== "cache_hit") {
      ps.errors++;
    }
    ps.avgLatency =
      ps.requests > 1
        ? (ps.avgLatency * (ps.requests - 1) + latency) / ps.requests
        : latency;

    // Per-model aggregation
    const model = entry.vendor_model || entry.model || "unknown";
    if (!daily.byModel[model]) {
      daily.byModel[model] = { requests: 0, tokens: 0, cacheHits: 0 };
    }
    daily.byModel[model].requests++;
    daily.byModel[model].tokens += promptTokens + completionTokens;
    if (entry.status === "cache_hit") {
      daily.byModel[model].cacheHits++;
    }
  }

  // ── Factory ─────────────────────────────────────────────────────

  private emptyDaily(date: string): DailyStats {
    return {
      date,
      totalRequests: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCacheHits: 0,
      totalErrors: 0,
      avgLatencyMs: 0,
      byProvider: {},
      byModel: {},
    };
  }

  // ── Queries ─────────────────────────────────────────────────────

  getSummary(): StatsSummary {
    let totalRequests = 0;
    let totalCacheHits = 0;
    let totalErrors = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let sumLatency = 0;
    let latencyCount = 0;
    const providerNames = new Set<string>();

    for (const daily of this.dailyCache.values()) {
      totalRequests += daily.totalRequests;
      totalCacheHits += daily.totalCacheHits;
      totalErrors += daily.totalErrors;
      totalPromptTokens += daily.totalPromptTokens;
      totalCompletionTokens += daily.totalCompletionTokens;

      if (daily.avgLatencyMs > 0 && daily.totalRequests > 0) {
        sumLatency += daily.avgLatencyMs * daily.totalRequests;
        latencyCount += daily.totalRequests;
      }

      for (const p of Object.keys(daily.byProvider)) {
        providerNames.add(p);
      }
    }

    const totalTokens = totalPromptTokens + totalCompletionTokens;

    return {
      totalTokens,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      cacheHitRate: totalRequests > 0 ? Math.round((totalCacheHits / totalRequests) * 100) : 0,
      cacheHits: totalCacheHits,
      totalRequests,
      totalErrors,
      healthyProviders: 0, // Health check requires active probing; set to 0 for now
      totalProviders: providerNames.size,
      avgLatencyMs: latencyCount > 0 ? Math.round(sumLatency / latencyCount) : 0,
      streamRatio: 0, // Not tracked in audit logs
    };
  }

  getDailyStats(days: number): DailyStats[] {
    const result: DailyStats[] = [];
    const now = new Date();
    for (let i = 0; i < days; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      result.push(this.dailyCache.get(key) || this.emptyDaily(key));
    }
    return result;
  }

  /** Aggregate per-model cache stats from all loaded daily stats. */
  getCacheEntries(): { model: string; requests: number; tokens: number; cacheHits: number }[] {
    if (!this.cacheDirty && this.cacheEntriesCache) {
      return this.cacheEntriesCache;
    }
    const map = new Map<string, { requests: number; tokens: number; cacheHits: number }>();
    for (const daily of this.dailyCache.values()) {
      for (const [model, ms] of Object.entries(daily.byModel)) {
        const cur = map.get(model) || { requests: 0, tokens: 0, cacheHits: 0 };
        cur.requests += ms.requests;
        cur.tokens += ms.tokens;
        cur.cacheHits += ms.cacheHits;
        map.set(model, cur);
      }
    }
    this.cacheEntriesCache = Array.from(map.entries())
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.requests - a.requests);
    this.cacheDirty = false;
    return this.cacheEntriesCache;
  }
}
