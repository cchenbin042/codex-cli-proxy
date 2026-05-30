// src/components/reliability/ReliabilityPage.tsx
import { useState, useEffect } from "react";
import { useConfig, useUpdateConfig } from "../../hooks/useConfig";
import type { AppConfig } from "../../lib/api/ipc";
import { useBackendStatus } from "../../hooks/useBackendStatus";
import { Save, RotateCcw, ShieldAlert, ShieldCheck, Clock } from "lucide-react";

const DEFAULT_RELIABILITY: AppConfig["reliability"] = {
  retry: { max_retries: 3, backoff_base_seconds: 2 },
  circuit_breaker: { failure_threshold: 5, cooldown_seconds: 30 },
  concurrency: { max_concurrent: 10, queue_timeout_seconds: 30 },
  rate_limit: { requests_per_minute: 30, burst_capacity: 30 },
};

export default function ReliabilityPage() {
  const { data: config } = useConfig();
  const updateConfig = useUpdateConfig();
  const { isError } = useBackendStatus();
  const [local, setLocal] = useState<AppConfig["reliability"]>(DEFAULT_RELIABILITY);

  useEffect(() => {
    if (config) setLocal(config.reliability);
  }, [config]);

  const update = (
    section: keyof AppConfig["reliability"],
    key: string,
    value: string
  ) => {
    setLocal((prev) => ({
      ...prev,
      [section]: { ...prev[section], [key]: Number(value) || 0 },
    }));
  };

  const resetField = (
    section: keyof AppConfig["reliability"],
    key: string
  ) => {
    const defVal = (DEFAULT_RELIABILITY[section] as Record<string, number>)[key];
    setLocal((prev) => ({
      ...prev,
      [section]: { ...prev[section], [key]: defVal },
    }));
  };

  const save = async () => {
    if (!config) return;
    try {
      const result = await updateConfig.mutateAsync({
        ...config,
        reliability: local,
      });
      if (!result.success && result.error) alert(result.error);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const r = local;
  const hasChanges = config && JSON.stringify(config.reliability) !== JSON.stringify(local);
  // Circuit breaker state — derived from backend status
  const circuitState: "closed" | "open" | "half_open" = isError ? "open" : "closed";

  const circuitLabel = circuitState === "closed" ? "CLOSED · 正常" : circuitState === "open" ? "OPEN · 熔断中" : "HALF_OPEN · 试探中";
  const circuitBadgeClass = circuitState === "closed" ? "circuit-closed" : circuitState === "open" ? "circuit-open" : "circuit-half";

  return (
    <div className="max-w-[720px]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[1.25rem] font-bold text-text-primary">可靠性配置</h2>
          <p className="text-[0.8rem] text-text-dim mt-0.5">控制重试、熔断、并发与限流策略</p>
        </div>
        <button
          disabled={updateConfig.isPending || !hasChanges}
          className="btn btn-primary btn-sm"
          onClick={save}
        >
          <Save size={14} />
          {updateConfig.isPending ? "保存中..." : "保存设置"}
        </button>
      </div>

      {/* Retry */}
      <Section icon={<RotateCcw size={16} />} title="重试策略">
        <Field label="最大重试次数" hint="上游 5xx 或连接错误时自动重试" defaultValue={DEFAULT_RELIABILITY.retry.max_retries} onReset={() => resetField("retry", "max_retries")}>
          <input type="number" className="input" value={r.retry.max_retries} onChange={(e) => update("retry", "max_retries", e.target.value)} />
        </Field>
        <Field label="退避基数 (秒)" hint="间隔 = 基数^n + 随机抖动" defaultValue={DEFAULT_RELIABILITY.retry.backoff_base_seconds} onReset={() => resetField("retry", "backoff_base_seconds")}>
          <input type="number" step="0.5" className="input" value={r.retry.backoff_base_seconds} onChange={(e) => update("retry", "backoff_base_seconds", e.target.value)} />
        </Field>
      </Section>

      {/* Circuit Breaker */}
      <Section icon={<ShieldAlert size={16} />} title="熔断器" badge={<CircuitStatus state={circuitState} />}>
        <Field label="失败阈值" hint="连续失败 N 次后触发熔断" defaultValue={DEFAULT_RELIABILITY.circuit_breaker.failure_threshold} onReset={() => resetField("circuit_breaker", "failure_threshold")}>
          <input type="number" className="input" value={r.circuit_breaker.failure_threshold} onChange={(e) => update("circuit_breaker", "failure_threshold", e.target.value)} />
        </Field>
        <Field label="冷却时间 (秒)" hint="熔断后冷却结束才尝试半开恢复" defaultValue={DEFAULT_RELIABILITY.circuit_breaker.cooldown_seconds} onReset={() => resetField("circuit_breaker", "cooldown_seconds")}>
          <input type="number" className="input" value={r.circuit_breaker.cooldown_seconds} onChange={(e) => update("circuit_breaker", "cooldown_seconds", e.target.value)} />
        </Field>
        <div className="col-span-full mt-1">
          <button className="btn btn-secondary btn-sm">重置熔断器</button>
        </div>
      </Section>

      {/* Concurrency */}
      <Section icon={<Clock size={16} />} title="并发控制">
        <Field label="最大并发数" hint="同时处理的上游请求数上限" defaultValue={DEFAULT_RELIABILITY.concurrency.max_concurrent} onReset={() => resetField("concurrency", "max_concurrent")}>
          <input type="number" className="input" value={r.concurrency.max_concurrent} onChange={(e) => update("concurrency", "max_concurrent", e.target.value)} />
        </Field>
        <Field label="队列超时 (秒)" hint="并发满时排队等待的最大时长" defaultValue={DEFAULT_RELIABILITY.concurrency.queue_timeout_seconds} onReset={() => resetField("concurrency", "queue_timeout_seconds")}>
          <input type="number" className="input" value={r.concurrency.queue_timeout_seconds} onChange={(e) => update("concurrency", "queue_timeout_seconds", e.target.value)} />
        </Field>
      </Section>

      {/* Rate Limit */}
      <Section icon={<ShieldCheck size={16} />} title="速率限制">
        <Field label="每分钟请求数" hint="令牌桶补充速率" defaultValue={DEFAULT_RELIABILITY.rate_limit.requests_per_minute} onReset={() => resetField("rate_limit", "requests_per_minute")}>
          <input type="number" className="input" value={r.rate_limit.requests_per_minute} onChange={(e) => update("rate_limit", "requests_per_minute", e.target.value)} />
        </Field>
        <Field label="突发容量" hint="瞬时 burst 允许的请求数" defaultValue={DEFAULT_RELIABILITY.rate_limit.burst_capacity} onReset={() => resetField("rate_limit", "burst_capacity")}>
          <input type="number" className="input" value={r.rate_limit.burst_capacity} onChange={(e) => update("rate_limit", "burst_capacity", e.target.value)} />
        </Field>
      </Section>

      <div className="text-right mt-4">
        <button
          disabled={updateConfig.isPending || !hasChanges}
          className="btn btn-primary"
          onClick={save}
        >
          <Save size={14} />
          {updateConfig.isPending ? "保存中..." : "保存设置"}
        </button>
      </div>
    </div>
  );
}

// ── Sub-components ──

function Section({
  icon,
  title,
  badge,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5 mb-3">
      <div className="flex items-center gap-2 mb-3.5">
        <span className="text-text-dim">{icon}</span>
        <h3 className="text-[0.7rem] uppercase tracking-wider font-bold text-text-dim">
          {title}
        </h3>
        {badge && <span className="ml-auto">{badge}</span>}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  defaultValue,
  onReset,
  children,
}: {
  label: string;
  hint?: string;
  defaultValue?: number;
  onReset?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[0.72rem] font-semibold text-text-secondary">
        {label}
      </label>
      <div className="flex items-center gap-2">
        {children}
        {onReset && (
          <button
            className="btn btn-ghost btn-xs text-text-dim"
            onClick={onReset}
            title={`恢复默认 (${defaultValue})`}
          >
            默认
          </button>
        )}
      </div>
      {hint && (
        <span className="text-[0.68rem] text-text-dim mt-0.5">{hint}</span>
      )}
    </div>
  );
}

function CircuitStatus({ state }: { state: "closed" | "open" | "half_open" }) {
  const label = state === "closed" ? "CLOSED · 正常" : state === "open" ? "OPEN · 熔断中" : "HALF_OPEN · 试探中";
  return (
    <span className={`circuit-indicator ${state === "closed" ? "circuit-closed" : state === "open" ? "circuit-open" : "circuit-half"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${state === "closed" ? "bg-green" : state === "open" ? "bg-red animate-pulse" : "bg-orange animate-pulse"}`} />
      {label}
    </span>
  );
}