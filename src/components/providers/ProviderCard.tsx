// src/components/providers/ProviderCard.tsx
import { useState } from "react";
import { electronAPI } from "../../lib/api/ipc";
import type { ProviderEntry } from "../../hooks/useProviders";
import {
  ChevronDown,
  ChevronUp,
  Star,
  Trash2,
  Eye,
  EyeOff,
  X,
  Plus,
  CheckCircle2,
  Globe,
  Key,
} from "lucide-react";

interface Props {
  provider: ProviderEntry & { _isNew?: boolean };
  onSaved: () => void;
}

export default function ProviderCard({ provider, onSaved }: Props) {
  const [expanded, setExpanded] = useState(!!provider._isNew);
  const [name, setName] = useState(provider.name);
  const [apiBase, setApiBase] = useState(provider.api_base);
  const [keys, setKeys] = useState<string[]>(
    provider.api_keys.length > 0 ? provider.api_keys : [""]
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const config = await electronAPI.getConfig();
      const oldName = provider.name;
      // Rename conflict detection: if target name differs and already exists
      if (oldName !== name) {
        if (config.providers[name]) {
          if (
            !confirm(
              `供应商标识 "${name}" 已存在，是否覆盖？原 "${name}" 的配置将被替换。`
            )
          ) {
            return;
          }
        }
        delete config.providers[oldName];
      }
      config.providers[name] = {
        api_base: apiBase,
        enabled: keys.some((k) => k.trim().length > 0),
        api_keys: keys.filter((k) => k.trim()),
      };
      if (config.model_map?.["__default__"] === oldName) {
        config.model_map["__default__"] = name;
      }
      const result = await electronAPI.updateConfig(config);
      if (!result.success && result.error) alert(result.error);
      else onSaved();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`删除供应商 "${name}"?`)) return;
    try {
      const config = await electronAPI.getConfig();
      delete config.providers[provider.name];
      if (config.model_map?.["__default__"] === provider.name) {
        delete config.model_map["__default__"];
      }
      const result = await electronAPI.updateConfig(config);
      if (!result.success && result.error) alert(result.error);
      else onSaved();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSetDefault = async () => {
    try {
      const config = await electronAPI.getConfig();
      config.model_map = config.model_map || {};
      config.model_map["__default__"] = provider.name;
      const result = await electronAPI.updateConfig(config);
      if (!result.success && result.error) alert(result.error);
      else onSaved();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      className={`card overflow-hidden transition-all ${
        provider.enabled ? "border-green/15" : ""
      }`}
    >
      {/* Collapsed header */}
      <div
        className="flex items-center justify-between px-5 py-3.5 cursor-pointer select-none hover:bg-surface-2/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center ${
              provider.enabled ? "bg-green/10" : "bg-surface-3"
            }`}
          >
            <Globe
              size={18}
              className={provider.enabled ? "text-green" : "text-text-dim"}
            />
          </div>
          <div>
            <div className="font-semibold text-[0.9rem] flex items-center gap-2">
              {name}
              {provider.is_default && (
                <span className="badge badge-accent">
                  <Star size={10} />
                  默认
                </span>
              )}
            </div>
            <div className="text-[0.7rem] text-text-dim mt-0.5 flex items-center gap-2">
              {provider.enabled ? (
                <span className="flex items-center gap-1 text-green">
                  <CheckCircle2 size={10} />
                  已启用
                </span>
              ) : (
                <span className="text-text-dim">未配置</span>
              )}
              <span>·</span>
              <span>{provider.api_base || "未设置 API Base"}</span>
            </div>
          </div>
        </div>
        <div className="text-text-dim">
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
      </div>

      {/* Expanded form */}
      {expanded && (
        <div className="px-5 pb-5 border-t border-border pt-4 bg-surface-2/30">
          <div className="grid grid-cols-1 gap-3.5">
            {/* Identifier */}
            <FormGroup label="供应商标识" icon={<Key size={13} />}>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="deepseek"
              />
            </FormGroup>

            {/* API Base */}
            <FormGroup label="API Base URL" icon={<Globe size={13} />}>
              <input
                className="input"
                value={apiBase}
                onChange={(e) => setApiBase(e.target.value)}
                placeholder="https://api.deepseek.com"
              />
            </FormGroup>

            {/* API Keys */}
            <div>
              <label className="text-[0.7rem] font-semibold uppercase text-text-dim tracking-wider mb-2 flex items-center gap-1.5">
                <Key size={12} />
                API Keys
              </label>
              <div className="flex flex-col gap-2">
                {keys.map((k, i) => (
                  <KeyInput
                    key={i}
                    value={k}
                    onChange={(v) => {
                      const next = [...keys];
                      next[i] = v;
                      setKeys(next);
                    }}
                    onRemove={() => setKeys(keys.filter((_, j) => j !== i))}
                  />
                ))}
              </div>
              <button
                className="flex items-center gap-1 text-[0.72rem] text-accent hover:text-accent-hover mt-2 transition-colors"
                onClick={() => setKeys([...keys, ""])}
              >
                <Plus size={12} />
                添加 Key
              </button>
            </div>

            {/* Actions */}
            <div className="flex gap-2 mt-1 pt-2 border-t border-border">
              <button
                disabled={saving}
                className="btn btn-primary btn-sm"
                onClick={handleSave}
              >
                保存
              </button>
              {!provider.is_default && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleSetDefault}
                >
                  <Star size={13} />
                  设为默认
                </button>
              )}
              <button
                className="btn btn-danger btn-sm ml-auto"
                onClick={handleDelete}
              >
                <Trash2 size={13} />
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──

function FormGroup({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[0.7rem] font-semibold uppercase text-text-dim tracking-wider flex items-center gap-1.5">
        {icon}
        {label}
      </label>
      {children}
    </div>
  );
}

function KeyInput({
  value,
  onChange,
  onRemove,
}: {
  value: string;
  onChange: (v: string) => void;
  onRemove: () => void;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex gap-1.5 items-center">
      <input
        type={visible ? "text" : "password"}
        className="input flex-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="sk-..."
      />
      <button
        className="btn btn-ghost btn-xs"
        onClick={() => setVisible(!visible)}
        title={visible ? "隐藏" : "显示"}
      >
        {visible ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
      <button
        className="btn btn-ghost btn-xs text-red hover:bg-red/10"
        onClick={onRemove}
      >
        <X size={13} />
      </button>
    </div>
  );
}
