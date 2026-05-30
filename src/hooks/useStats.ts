// src/hooks/useStats.ts
import { useQuery } from "@tanstack/react-query";
import { electronAPI, StatsSummary, DailyStats } from "../lib/api/ipc";

export interface HourlyTrendPoint {
  hour: string;
  count: number;
}

export interface ProviderUsagePoint {
  provider_id: string;
  count: number;
  total_tokens: number;
}

export function useUsageSummary() {
  return useQuery<StatsSummary>({
    queryKey: ["stats-summary"],
    queryFn: () => electronAPI.getStatsSummary(),
    refetchInterval: 5000,
  });
}

// ── Unified daily stats data source ──

export function useDailyStats(days: number = 1) {
  return useQuery<DailyStats[]>({
    queryKey: ["daily-stats", days],
    queryFn: () => electronAPI.getDailyStats(days),
    refetchInterval: 30000,
    staleTime: 25000,
  });
}

// ── Derived hooks — consume useDailyStats(1) ──

export function useHourlyTrend(): HourlyTrendPoint[] {
  const { data } = useDailyStats(1);
  if (!data?.length) return [];
  return data.map((d) => ({
    hour: d.date,
    count: d.totalRequests,
  }));
}

export function useProviderDistribution(): ProviderUsagePoint[] {
  const { data } = useDailyStats(1);
  if (!data?.length) return [];
  const first = data[0];
  return Object.entries(first.byProvider || {}).map(([id, ps]) => ({
    provider_id: id,
    count: ps.requests,
    total_tokens: ps.tokens,
  }));
}
