// src/components/dashboard/DashboardPage.tsx
import { useBackendStatus } from "../../hooks/useBackendStatus";
import StatusCard from "./StatusCard";
import StatsCards from "./StatsCards";
import ProviderGrid from "./ProviderGrid";
import { RequestTrendChart, ProviderUsageChart } from "./Charts";
import { Power, PowerOff, RotateCw } from "lucide-react";
import { useState } from "react";
import { electronAPI } from "../../lib/api/ipc";

export default function DashboardPage() {
  const { status, port, uptime, isRunning, isStarting, isStopping } =
    useBackendStatus();
  const [loading, setLoading] = useState(false);

  const doAction = async (
    action: () => Promise<{ success: boolean; error?: string }>
  ) => {
    setLoading(true);
    try {
      const result = await action();
      if (!result.success && result.error) alert(result.error);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  };

  const busy = isStarting || isStopping || loading;

  return (
    <div className="max-w-[960px]">
      {/* Header row */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[1.25rem] font-bold text-text-primary">
            仪表盘
          </h2>
          <p className="text-[0.8rem] text-text-dim mt-0.5">
            代理状态监控与用量统计
          </p>
        </div>
        <div className="flex gap-2">
          {isRunning ? (
            <>
              <button
                disabled={busy}
                className="btn btn-danger btn-sm"
                onClick={() => doAction(electronAPI.stopProxy)}
              >
                <PowerOff size={14} />
                停止
              </button>
              <button
                disabled={busy}
                className="btn btn-secondary btn-sm"
                onClick={() => doAction(electronAPI.restartProxy)}
              >
                <RotateCw size={14} />
                重启
              </button>
            </>
          ) : (
            <button
              disabled={busy}
              className="btn btn-primary btn-sm"
              onClick={() => doAction(electronAPI.startProxy)}
            >
              <Power size={14} />
              启动代理
            </button>
          )}
        </div>
      </div>

      {/* Status hero card */}
      <StatusCard status={status} port={port} uptime={uptime} />

      {/* Stat cards */}
      <StatsCards />

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <RequestTrendChart />
        <ProviderUsageChart />
      </div>

      {/* Provider grid */}
      <ProviderGrid />
    </div>
  );
}
