// src/components/dashboard/StatsCards.tsx
import { useUsageSummary } from "../../hooks/useStats";
import { BarChart3, Database, Zap, Timer } from "lucide-react";

export default function StatsCards() {
  const { data } = useUsageSummary();
  const s = data ?? {
    totalRequests: 0,
    totalTokens: 0,
    cacheHitRate: 0,
    avgLatencyMs: 0,
    healthyProviders: 0,
    totalProviders: 0,
    streamRatio: 0,
    promptTokens: 0,
    completionTokens: 0,
  };

  const items = [
    {
      icon: BarChart3,
      value: s.totalRequests.toLocaleString(),
      label: "请求总数",
      accent: "text-accent",
      bg: "bg-accent/10",
    },
    {
      icon: Database,
      value: `${s.cacheHitRate.toFixed(0)}%`,
      label: "缓存命中率",
      accent: "text-green",
      bg: "bg-green/10",
    },
    {
      icon: Zap,
      value: formatTokens(s.totalTokens),
      label: "Token 消耗",
      accent: "text-orange",
      bg: "bg-orange/10",
    },
    {
      icon: Timer,
      value: `${(s.avgLatencyMs ?? 0).toFixed(0)} ms`,
      label: "平均延迟",
      accent: "text-purple-400",
      bg: "bg-purple-400/10",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      {items.map((item) => (
        <div key={item.label} className="card p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-9 h-9 rounded-lg ${item.bg} flex items-center justify-center`}>
              <item.icon size={18} className={item.accent} />
            </div>
            <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-text-dim">
              {item.label}
            </span>
          </div>
          <div className={`text-[1.6rem] font-bold ${item.accent} stat-value`}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
