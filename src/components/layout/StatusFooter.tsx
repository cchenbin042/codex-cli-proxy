// src/components/layout/StatusFooter.tsx
import { useBackendStatus } from "../../hooks/useBackendStatus";

export default function StatusFooter() {
  const { status, isRunning, isStarting, isStopping, isError, port } =
    useBackendStatus();

  const dotClass = isRunning
    ? "status-dot status-dot-running"
    : isError
      ? "status-dot status-dot-error"
      : isStarting || isStopping
        ? "status-dot status-dot-starting"
        : "status-dot status-dot-stopped";

  const label = isRunning
    ? `运行中 :${port}`
    : isStarting
      ? "启动中..."
      : isStopping
        ? "停止中..."
        : isError
          ? "异常"
          : "已停止";

  return (
    <div className="px-4 py-3 border-t border-border flex items-center gap-2.5 text-[0.75rem] text-text-secondary">
      <span className={dotClass} />
      <span>{label}</span>
    </div>
  );
}
