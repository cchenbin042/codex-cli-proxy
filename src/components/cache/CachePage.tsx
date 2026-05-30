// src/components/cache/CachePage.tsx
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { electronAPI } from "../../lib/api/ipc";
import { Trash2, Pause, Play } from "lucide-react";

interface CacheEntry {
  model: string;
  requests: number;
  tokens: number;
  cacheHits: number;
}

const PAGE_SIZE = 20;
const TTL_DEFAULT = 300;
const TTL_MIN = 1;
const TTL_MAX = 86400;

export default function CachePage() {
  const queryClient = useQueryClient();
  const [ttl, setTtl] = useState(TTL_DEFAULT);
  const [ttlSaving, setTtlSaving] = useState(false);
  const [ttlError, setTtlError] = useState("");
  const [savedTtl, setSavedTtl] = useState(TTL_DEFAULT);
  const [cachePaused, setCachePaused] = useState(false);
  const [page, setPage] = useState(1);

  const { data: stats } = useQuery({
    queryKey: ["cache-stats"],
    queryFn: () => electronAPI.getStatsSummary(),
    refetchInterval: 5000,
  });

  const { data: rawEntries } = useQuery({
    queryKey: ["cache-entries"],
    queryFn: () => electronAPI.getCacheEntries(),
    refetchInterval: 5000,
  });

  const entries: CacheEntry[] = rawEntries ?? [];
  const hits = stats?.cacheHits ?? 0;
  const total = stats?.totalRequests ?? 0;
  const errors = stats?.totalErrors ?? 0;
  const misses = total - hits - errors;
  const hitRate = total > 0 ? hits / total : 0;
  const capacity = 1000;
  const current = entries.length;
  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const paged = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const hitPct = total > 0 ? Math.round(hitRate * 100) : 0;
  const missPct = total > 0 ? Math.round((misses / total) * 100) : 0;
  const conicGradient =
    total > 0
      ? `conic-gradient(#34d399 0% ${hitPct}%, #6b6b7b ${hitPct}% ${
          hitPct + missPct
        }%, #f59e0b ${hitPct + missPct}% 100%)`
      : "conic-gradient(#6b6b7b 0% 100%)";

  const isTtlValid = ttl >= TTL_MIN && ttl <= TTL_MAX && Number.isInteger(ttl);

  const handleTtlChange = (value: number) => {
    setTtl(value);
    if (isNaN(value) || !Number.isInteger(value)) {
      setTtlError("必须为整数");
    } else if (value < TTL_MIN || value > TTL_MAX) {
      setTtlError(`范围 ${TTL_MIN}-${TTL_MAX} 秒`);
    } else {
      setTtlError("");
    }
  };

  const handleSaveTtl = async () => {
    if (!isTtlValid || ttlSaving) return;
    setTtlSaving(true);
    setTtlError("");
    try {
      const result = await electronAPI.setCacheTtl(ttl);
      if (result.success) {
        setSavedTtl(ttl);
        queryClient.invalidateQueries({ queryKey: ["cache-stats"] });
      } else {
        setTtlError(result.error || "保存失败");
      }
    } catch (e: unknown) {
      setTtlError(e instanceof Error ? e.message : "未知错误");
    } finally {
      setTtlSaving(false);
    }
  };

  const handleClear = async () => {
    if (!confirm("确认清空所有缓存？此操作不可撤销。")) return;
    try {
      const result = await electronAPI.clearCache();
      if (!result.success && result.error) {
        alert(result.error);
      }
      queryClient.invalidateQueries({ queryKey: ["cache-stats"] });
      queryClient.invalidateQueries({ queryKey: ["cache-entries"] });
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="max-w-[800px]">
      <div className="mb-6">
        <h2 className="text-[1.25rem] font-bold text-text-primary">缓存管理</h2>
        <p className="text-[0.8rem] text-text-dim mt-0.5">
          响应缓存状态与配置
        </p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {/* Hit Rate Donut */}
        <div className="card p-4 flex flex-col items-center gap-3">
          <div className="section-header text-center">命中率</div>
          <div
            className="relative w-[100px] h-[100px] rounded-full"
            style={{ background: conicGradient }}
          >
            <div className="absolute inset-[24px] rounded-full bg-surface flex flex-col items-center justify-center">
              <div className="text-[1.3rem] font-bold">{hitPct}%</div>
              <div className="text-[0.6rem] text-text-dim">命中率</div>
            </div>
          </div>
          <div className="flex gap-3 text-[0.65rem]">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-green" /> 命中 {hits}
            </span>
            <span className="flex items-center gap-1">
              <span
                className="w-2 h-2 rounded-sm"
                style={{ background: "#6b6b7b" }}
              />{" "}
              未命中 {misses}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-orange" /> 错误 {errors}
            </span>
          </div>
        </div>

        {/* Capacity */}
        <div className="card p-4">
          <div className="section-header">容量使用</div>
          <div className="flex flex-col gap-3 mt-2">
            <div className="flex justify-between text-[0.75rem]">
              <span>
                {current} / {capacity} 条目
              </span>
              <span className="text-text-dim">
                {Math.round((current / capacity) * 100)}%
              </span>
            </div>
            <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${(current / capacity) * 100}%` }}
              />
            </div>
            <div className="flex flex-col gap-1 mt-1">
              <InfoRow label="最大容量" value={String(capacity)} />
              <InfoRow label="当前条目" value={String(current)} />
            </div>
          </div>
        </div>

        {/* TTL */}
        <div className="card p-4 flex flex-col items-center justify-center gap-2">
          <div className="section-header text-center">TTL 状态</div>
          <div className="text-[1.8rem] font-bold font-mono text-accent">
            {cachePaused ? "--:--" : fmtTTL(savedTtl)}
          </div>
          <div className="text-[0.68rem] text-text-dim">
            全局 TTL: {savedTtl}s
          </div>
          <span
            className={`badge ${cachePaused ? "badge-red" : "badge-green"}`}
          >
            {cachePaused ? "已暂停" : "运行中"}
          </span>
        </div>
      </div>

      {/* Config */}
      <div className="card p-4 mb-3">
        <div className="section-header">TTL 设置</div>
        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[0.72rem] font-semibold text-text-secondary">
              缓存过期时间 (秒)
            </label>
            <input
              type="number"
              className="input w-28"
              value={ttl}
              min={TTL_MIN}
              max={TTL_MAX}
              onChange={(e) =>
                handleTtlChange(Number(e.target.value) || TTL_DEFAULT)
              }
            />
            {ttlError && (
              <p className="text-[0.65rem] text-red mt-0.5">{ttlError}</p>
            )}
          </div>
          <button
            className="btn btn-primary btn-sm"
            disabled={ttlSaving || !isTtlValid}
            onClick={handleSaveTtl}
          >
            {ttlSaving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="card p-4 mb-4">
        <div className="section-header">操作</div>
        <div className="flex gap-2">
          <button className="btn btn-danger btn-sm" onClick={handleClear}>
            <Trash2 size={13} /> 清空全部缓存
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setCachePaused(!cachePaused)}
          >
            {cachePaused ? <Play size={13} /> : <Pause size={13} />}
            {cachePaused ? "恢复缓存" : "暂停缓存"}
          </button>
        </div>
      </div>

      {/* Cache Entry List */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between border-b border-border">
          <h3 className="text-[0.75rem] font-semibold">
            缓存条目（基于审计日志统计）
          </h3>
          <span className="text-[0.68rem] text-text-dim">
            第 {page}/{Math.max(1, totalPages)} 页
          </span>
        </div>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-surface-2/50">
              <th className="text-left px-4 py-2 text-[0.65rem] uppercase text-text-dim tracking-wider font-semibold border-b border-border">
                模型
              </th>
              <th className="text-left px-4 py-2 text-[0.65rem] uppercase text-text-dim tracking-wider font-semibold border-b border-border">
                请求数
              </th>
              <th className="text-left px-4 py-2 text-[0.65rem] uppercase text-text-dim tracking-wider font-semibold border-b border-border">
                Token
              </th>
              <th className="text-left px-4 py-2 text-[0.65rem] uppercase text-text-dim tracking-wider font-semibold border-b border-border">
                缓存命中
              </th>
              <th className="text-left px-4 py-2 text-[0.65rem] uppercase text-text-dim tracking-wider font-semibold border-b border-border">
                命中率
              </th>
            </tr>
          </thead>
          <tbody>
            {paged.map((e, i) => (
              <tr
                key={e.model}
                className="border-b border-border hover:bg-surface-2/30 transition-colors"
              >
                <td className="px-4 py-2.5 font-mono text-[0.78rem]">
                  {e.model}
                </td>
                <td className="px-4 py-2.5 text-text-secondary text-[0.78rem]">
                  {e.requests}
                </td>
                <td className="px-4 py-2.5 font-mono text-[0.75rem] text-text-dim">
                  {formatTokens(e.tokens)}
                </td>
                <td className="px-4 py-2.5 text-[0.78rem] text-text-secondary">
                  {e.cacheHits}
                </td>
                <td className="px-4 py-2.5 text-[0.78rem]">
                  <span
                    className={`badge ${
                      e.requests > 0 && e.cacheHits / e.requests >= 0.5
                        ? "badge-green"
                        : e.cacheHits > 0
                          ? "badge-accent"
                          : "badge-red"
                    }`}
                  >
                    {e.requests > 0
                      ? `${Math.round((e.cacheHits / e.requests) * 100)}%`
                      : "0%"}
                  </span>
                </td>
              </tr>
            ))}
            {paged.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-12">
                  <p className="text-text-dim text-sm">
                    暂无缓存数据，发起请求后将自动统计
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-1 py-3 border-t border-border">
            <button
              className="btn btn-ghost btn-xs"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                className={`btn btn-xs ${
                  p === page ? "btn-primary" : "btn-ghost"
                }`}
                onClick={() => setPage(p)}
              >
                {p}
              </button>
            ))}
            <button
              className="btn btn-ghost btn-xs"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[0.72rem] py-1 border-b border-border last:border-0">
      <span className="text-text-secondary">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function fmtTTL(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
