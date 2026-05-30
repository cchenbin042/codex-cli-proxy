// src/components/settings/SettingsPage.tsx
import { useState, useEffect } from "react";
import { useConfig, useUpdateConfig } from "../../hooks/useConfig";
import type { AppConfig } from "../../lib/api/ipc";
import { Save, Server, ScrollText, Brain, Palette } from "lucide-react";

const DEFAULT_CONFIG: AppConfig = {
  server: { host: "127.0.0.1", port: 8317 },
  deepseek: { api_base: "https://api.deepseek.com", api_keys: [], thinking_disabled: false },
  model_map: {},
  reliability: {
    retry: { max_retries: 3, backoff_base_seconds: 2 },
    circuit_breaker: { failure_threshold: 5, cooldown_seconds: 30 },
    concurrency: { max_concurrent: 10, queue_timeout_seconds: 30 },
    rate_limit: { requests_per_minute: 30, burst_capacity: 30 },
  },
  providers: {},
};

export default function SettingsPage() {
  const { data: config } = useConfig();
  const updateConfig = useUpdateConfig();
  const [local, setLocal] = useState<AppConfig>(DEFAULT_CONFIG);
  const [theme, setTheme] = useState("dark");
  const [language, setLanguage] = useState("zh");

  useEffect(() => {
    if (config) setLocal(config);
  }, [config]);

  const updateServer = (key: string, value: string) => {
    setLocal((prev) => ({
      ...prev,
      server: { ...prev.server, [key]: key === "port" ? Number(value) || 8317 : value },
    }));
  };

  const save = async () => {
    try {
      const result = await updateConfig.mutateAsync(local);
      if (!result.success && result.error) alert(result.error);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="max-w-[720px]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[1.25rem] font-bold text-text-primary">设置</h2>
          <p className="text-[0.8rem] text-text-dim mt-0.5">配置代理服务器参数</p>
        </div>
        <button
          disabled={updateConfig.isPending}
          className="btn btn-primary btn-sm"
          onClick={save}
        >
          <Save size={14} />
          {updateConfig.isPending ? "保存中..." : "保存设置"}
        </button>
      </div>

      {/* Server */}
      <Section icon={<Server size={16} />} title="服务器">
        <Field label="监听地址">
          <input
            className="input"
            value={local.server.host}
            onChange={(e) => updateServer("host", e.target.value)}
          />
        </Field>
        <Field label="监听端口" hint="修改后保存自动重启生效">
          <input
            type="number"
            className="input"
            value={local.server.port}
            onChange={(e) => updateServer("port", e.target.value)}
          />
        </Field>
      </Section>

      {/* Audit Log */}
      <Section icon={<ScrollText size={16} />} title="审计日志">
        <Field label="日志目录" hint="JSONL 格式，按日期分文件">
          <input className="input" value="./audit_logs/" readOnly style={{ opacity: 0.6 }} />
        </Field>
      </Section>

      {/* Reasoning Store */}
      <Section icon={<Brain size={16} />} title="Reasoning 持久化">
        <div className="col-span-full flex items-center justify-between">
          <div>
            <div className="text-[0.8rem]">当前存储文件</div>
            <div className="text-[0.68rem] text-text-dim mt-0.5 font-mono">reasoning_stores.json</div>
          </div>
          <button className="btn btn-danger btn-sm">清除 Reasoning</button>
        </div>
      </Section>

      {/* Appearance */}
      <Section icon={<Palette size={16} />} title="外观">
        <Field label="主题">
          <select className="input" value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="dark">暗色</option>
            <option value="light" disabled>亮色 (开发中)</option>
          </select>
        </Field>
        <Field label="语言">
          <select className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </Field>
      </Section>

      <div className="text-right mt-4">
        <button
          disabled={updateConfig.isPending}
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

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5 mb-3">
      <div className="flex items-center gap-2 mb-3.5">
        <span className="text-text-dim">{icon}</span>
        <h3 className="text-[0.7rem] uppercase tracking-wider font-bold text-text-dim">{title}</h3>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[0.72rem] font-semibold text-text-secondary">{label}</label>
      {children}
      {hint && <span className="text-[0.68rem] text-text-dim mt-0.5">{hint}</span>}
    </div>
  );
}