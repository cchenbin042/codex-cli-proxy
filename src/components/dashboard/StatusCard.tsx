// src/components/dashboard/StatusCard.tsx
import {
  ShieldCheck,
  ShieldOff,
  ShieldAlert,
  Clock,
  Cable,
} from "lucide-react";

interface Props {
  status: string;
  port?: number;
  uptime?: number;
}

const STATUS_CONFIG: Record<
  string,
  { icon: typeof ShieldCheck; label: string; className: string }
> = {
  running: {
    icon: ShieldCheck,
    label: "代理运行中",
    className: "text-green",
  },
  stopped: {
    icon: ShieldOff,
    label: "代理已停止",
    className: "text-text-dim",
  },
  starting: {
    icon: Clock,
    label: "正在启动...",
    className: "text-orange",
  },
  stopping: {
    icon: Clock,
    label: "正在停止...",
    className: "text-orange",
  },
  error: {
    icon: ShieldAlert,
    label: "代理异常",
    className: "text-red",
  },
};

export default function StatusCard({ status, port, uptime }: Props) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.stopped;
  const Icon = cfg.icon;

  return (
    <div className="card-elevated p-6 mb-4 relative overflow-hidden">
      {/* Gradient accent bar at top */}
      <div
        className={`absolute top-0 left-0 right-0 h-1 ${
          status === "running"
            ? "bg-green"
            : status === "error"
              ? "bg-red"
              : status === "starting" || status === "stopping"
                ? "bg-orange"
                : "bg-border"
        }`}
      />

      <div className="flex items-center justify-between flex-wrap gap-4 mt-1">
        <div className="flex items-center gap-4">
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              status === "running"
                ? "bg-green/10"
                : status === "error"
                  ? "bg-red/10"
                  : status === "starting" || status === "stopping"
                    ? "bg-orange/10"
                    : "bg-surface-3"
            }`}
          >
            <Icon
              size={24}
              className={`${cfg.className} ${
                status === "starting" || status === "stopping"
                  ? "animate-pulse"
                  : ""
              }`}
            />
          </div>
          <div>
            <div
              className={`text-[1.05rem] font-semibold ${cfg.className}`}
            >
              {cfg.label}
            </div>
            <div className="text-[0.78rem] text-text-dim flex gap-4 mt-0.5">
              <span className="flex items-center gap-1.5">
                <Cable size={12} />
                端口 {port || "—"}
              </span>
              {status === "running" && uptime != null && uptime > 0 && (
                <span className="flex items-center gap-1.5">
                  <Clock size={12} />
                  {formatUptime(uptime)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `运行 ${h} 小时 ${m} 分钟`;
  if (m > 0) return `运行 ${m} 分钟 ${sec} 秒`;
  return `运行 ${sec} 秒`;
}
