// src/components/logs/LogsPage.tsx
import { useRef, useEffect, useState } from "react";
import { useLogStream } from "../../hooks/useLogStream";
import { Search, Pause, Play, Trash2, ScrollText, ChevronDown, ChevronUp } from "lucide-react";

export default function LogsPage() {
  const {
    entries,
    displayed,
    paused,
    filter,
    search,
    setFilter,
    setSearch,
    togglePause,
    clear,
  } = useLogStream();

  const containerRef = useRef<HTMLDivElement>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  useEffect(() => {
    if (containerRef.current && !paused) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [displayed, paused]);

  // Parse log message to extract structured fields
  const parseEntry = (msg: string) => {
    const traceMatch = msg.match(/\[(tr_[a-f0-9]{24})\]/);
    return {
      traceId: traceMatch ? traceMatch[1] : "",
      model: extractField(msg, "model="),
      provider: extractField(msg, "provider="),
      vendorModel: extractField(msg, "vendor_model="),
      elapsedMs: extractField(msg, "elapsed="),
      status: extractStatus(msg),
    };
  };

  return (
    <div className="max-w-[960px]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[1.25rem] font-bold text-text-primary">请求日志</h2>
          <p className="text-[0.8rem] text-text-dim mt-0.5">实时显示代理处理的所有请求</p>
        </div>
        <div className="text-[0.75rem] text-text-dim">{entries.length.toLocaleString()} 条日志</div>
      </div>

      {/* Toolbar */}
      <div className="card p-3 mb-3">
        <div className="flex justify-between items-center flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <select
              className="input text-sm py-1.5"
              value={filter}
              onChange={(e) => setFilter(e.target.value as "ALL" | "INFO" | "WARN" | "ERROR" | "DEBUG")}
            >
              <option value="ALL">全部级别</option>
              <option value="INFO">INFO</option>
              <option value="WARN">WARN</option>
              <option value="ERROR">ERROR</option>
              <option value="DEBUG">DEBUG</option>
            </select>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-dim" />
              <input
                className="input pl-8 w-[240px] text-sm py-1.5"
                placeholder="搜索 trace_id / 模型 / 消息..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button className="btn btn-ghost btn-sm" onClick={togglePause} title={paused ? "继续" : "暂停"}>
              {paused ? <Play size={14} /> : <Pause size={14} />}
              {paused ? "继续" : "暂停"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={clear} title="清空">
              <Trash2 size={14} /> 清空
            </button>
          </div>
        </div>
      </div>

      {/* Log Table */}
      <div className="card overflow-hidden">
        <div ref={containerRef} className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 260px)" }}>
          {displayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-text-dim">
              <ScrollText size={36} className="mb-3 opacity-30" />
              <p className="text-sm">
                {entries.length === 0 ? "启动代理并发送请求后此处将显示实时日志" : "没有匹配的日志条目"}
              </p>
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-surface-2/90 backdrop-blur-sm">
                  <th className="text-left px-3 py-2 text-[0.65rem] uppercase text-text-dim tracking-wider font-semibold border-b border-border w-[80px]">时间</th>
                  <th className="text-left px-3 py-2 text-[0.65rem] uppercase text-text-dim tracking-wider font-semibold border-b border-border w-[44px]">级别</th>
                  <th className="text-left px-3 py-2 text-[0.65rem] uppercase text-text-dim tracking-wider font-semibold border-b border-border">消息</th>
                  <th className="text-left px-3 py-2 text-[0.65rem] uppercase text-text-dim tracking-wider font-semibold border-b border-border w-[80px]">状态</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((e, i) => {
                  const parsed = parseEntry(e.message);
                  const statusBadge = getStatusBadge(e, parsed);
                  const isExpanded = expandedIdx === i;

                  return (
                    <>
                      <tr
                        key={`${e.timestamp}-${i}`}
                        className={`border-b border-border hover:bg-surface-2/40 transition-colors cursor-pointer ${
                          e.level === "ERROR" ? "bg-red/5" : e.level === "WARN" ? "bg-orange/5" : ""
                        }`}
                        onClick={() => setExpandedIdx(isExpanded ? null : i)}
                      >
                        <td className="px-3 py-2 text-text-dim text-[0.7rem] font-mono whitespace-nowrap select-none">
                          {new Date(e.timestamp).toLocaleTimeString("zh-CN", { hour12: false })}
                        </td>
                        <td className="px-1 py-2 text-center select-none">
                          <span
                            className={`text-[0.65rem] font-bold ${
                              e.level === "ERROR" ? "text-red" : e.level === "WARN" ? "text-orange" : e.level === "DEBUG" ? "text-text-dim" : "text-accent"
                            }`}
                          >
                            {e.level}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {parsed.traceId && (
                              <span className="text-[0.68rem] font-mono text-accent bg-accent-soft px-1.5 py-0.5 rounded whitespace-nowrap">
                                {parsed.traceId.length > 20 ? parsed.traceId.slice(0, 20) + "..." : parsed.traceId}
                              </span>
                            )}
                            {parsed.model && (
                              <span className="text-[0.68rem] font-mono text-text-secondary bg-surface-3 px-1.5 py-0.5 rounded whitespace-nowrap">
                                {parsed.model}
                              </span>
                            )}
                            <span className="text-[0.75rem] text-text-secondary truncate">{e.message.split(" | ").slice(1).join(" | ") || e.message}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">{statusBadge}</td>
                      </tr>
                      {/* Expanded detail row */}
                      {isExpanded && (
                        <tr key={`${e.timestamp}-${i}-exp`} className="bg-surface-2/20 border-b border-border">
                          <td colSpan={4} className="px-6 py-3">
                            <div className="text-[0.72rem] font-mono text-text-secondary bg-surface-3 rounded-md p-3 overflow-x-auto whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                              {e.message}
                            </div>
                            <div className="flex gap-4 mt-2 text-[0.68rem] text-text-dim">
                              <span>来源: {e.source}</span>
                              {parsed.elapsedMs && <span>耗时: {parsed.elapsedMs}ms</span>}
                              {parsed.provider && <span>供应商: {parsed.provider}</span>}
                              {parsed.vendorModel && <span>上游: {parsed.vendorModel}</span>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {displayed.length > 0 && (
          <div className="px-3 py-1.5 border-t border-border text-[0.65rem] text-text-dim flex items-center justify-between">
            <span>显示 {displayed.length} 条 · 共 {entries.length.toLocaleString()} 条{paused ? " (已暂停)" : " · 自动滚动"}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function extractField(msg: string, key: string): string {
  const idx = msg.indexOf(key);
  if (idx === -1) return "";
  const start = idx + key.length;
  const end = msg.indexOf(" ", start);
  return end === -1 ? msg.slice(start) : msg.slice(start, end);
}

function extractStatus(msg: string): "ok" | "cache" | "error" | "warn" | "" {
  if (msg.includes("cache_hit")) return "cache";
  if (msg.includes("ERROR") || msg.includes("error") || msg.includes(" 500 ")) return "error";
  if (msg.includes("WARN") || msg.includes("warn")) return "warn";
  if (msg.includes("completed") || msg.includes("200")) return "ok";
  return "";
}

function getStatusBadge(e: { level: string }, parsed: { status: string; elapsedMs?: string }) {
  if (parsed.status === "cache") {
    return <span className="badge badge-accent">缓存命中</span>;
  }
  if (parsed.status === "error" || e.level === "ERROR") {
    return <span className="badge badge-red">错误</span>;
  }
  if (e.level === "WARN") {
    return <span className="badge" style={{ background: "var(--color-orange-soft)", color: "var(--color-orange)" }}>警告</span>;
  }
  if (parsed.status === "ok") {
    return <span className="badge badge-green">已完成</span>;
  }
  return <span className="badge" style={{ background: "var(--color-surface-3)", color: "var(--color-text-dim)" }}>INFO</span>;
}