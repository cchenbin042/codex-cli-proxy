// src/components/providers/PresetDialog.tsx
import { useState } from "react";
import { electronAPI } from "../../lib/api/ipc";
import { X, Download, Check, Globe } from "lucide-react";

const PRESETS = [
  { id: "deepseek", name: "DeepSeek", api_base: "https://api.deepseek.com", desc: "DeepSeek 官方 API" },
  { id: "siliconflow", name: "SiliconFlow", api_base: "https://api.siliconflow.cn", desc: "硅基流动 API 平台" },
  { id: "qwen", name: "通义千问", api_base: "https://dashscope.aliyuncs.com/compatible-mode", desc: "阿里云 DashScope" },
  { id: "bailian", name: "阿里百炼", api_base: "https://dashscope.aliyuncs.com/compatible-mode", desc: "阿里百炼平台" },
  { id: "moonshot", name: "Moonshot", api_base: "https://api.moonshot.cn", desc: "月之暗面 Kimi" },
  { id: "openai", name: "OpenAI", api_base: "https://api.openai.com", desc: "OpenAI 官方 API" },
  { id: "azure", name: "Azure OpenAI", api_base: "https://YOUR_RESOURCE.openai.azure.com", desc: "Azure OpenAI 服务" },
  { id: "groq", name: "Groq", api_base: "https://api.groq.com", desc: "Groq 高速推理" },
  { id: "together", name: "Together AI", api_base: "https://api.together.xyz", desc: "Together AI 平台" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export default function PresetDialog({ open, onClose, onImported }: Props) {
  const [importing, setImporting] = useState<string | null>(null);
  const [imported, setImported] = useState<Set<string>>(new Set());

  if (!open) return null;

  const handleImport = async (preset: (typeof PRESETS)[0]) => {
    setImporting(preset.id);
    try {
      const config = await electronAPI.getConfig();
      if (config.providers[preset.id]) {
        alert("该供应商已存在");
        setImporting(null);
        return;
      }
      config.providers[preset.id] = {
        api_base: preset.api_base,
        enabled: false,
        api_keys: [],
      };
      const result = await electronAPI.updateConfig(config);
      if (!result.success && result.error) {
        alert(result.error);
      } else {
        setImported((prev) => new Set(prev).add(preset.id));
        onImported();
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    }
    setImporting(null);
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="card-elevated w-[680px] max-h-[75vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <div>
            <h3 className="font-bold text-[1.05rem]">导入预设供应商</h3>
            <p className="text-[0.75rem] text-text-dim mt-0.5">
              选择一个预设模板快速添加供应商，之后可自行编辑 API Key
            </p>
          </div>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm"
          >
            <X size={18} />
          </button>
        </div>

        {/* Grid */}
        <div className="p-6 grid grid-cols-2 gap-3">
          {PRESETS.map((p) => {
            const done = imported.has(p.id);
            const busy = importing === p.id;
            return (
              <div
                key={p.id}
                className="bg-surface-2 border border-border hover:border-border-light rounded-lg p-4 flex flex-col gap-2 transition-all"
              >
                <div className="flex items-center gap-2">
                  <Globe size={15} className="text-text-dim" />
                  <span className="font-semibold text-[0.85rem]">{p.name}</span>
                </div>
                <div className="text-[0.72rem] text-text-dim">{p.desc}</div>
                <div className="text-[0.7rem] text-text-dim truncate font-mono">
                  {p.api_base}
                </div>
                <button
                  disabled={busy || done}
                  className={`btn btn-sm mt-1 ${
                    done
                      ? "btn-secondary text-green border-green/20"
                      : "btn-primary"
                  }`}
                  onClick={() => handleImport(p)}
                >
                  {busy ? (
                    "导入中..."
                  ) : done ? (
                    <>
                      <Check size={13} />
                      已导入
                    </>
                  ) : (
                    <>
                      <Download size={13} />
                      一键导入
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
