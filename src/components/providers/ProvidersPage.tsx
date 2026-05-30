// src/components/providers/ProvidersPage.tsx
import { useState } from "react";
import { useProviders } from "../../hooks/useProviders";
import ProviderCard from "./ProviderCard";
import PresetDialog from "./PresetDialog";
import { Plus, Download, Server } from "lucide-react";

export default function ProvidersPage() {
  const { data, refetch } = useProviders();
  const [showPreset, setShowPreset] = useState(false);
  const providers = data ?? [];

  return (
    <div className="max-w-[800px]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[1.25rem] font-bold text-text-primary">
            提供商管理
          </h2>
          <p className="text-[0.8rem] text-text-dim mt-0.5">
            配置 LLM API 供应商与密钥
          </p>
        </div>
        <button
          onClick={() => setShowPreset(true)}
          className="btn btn-secondary btn-sm"
        >
          <Download size={14} />
          导入预设
        </button>
      </div>

      {providers.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-surface-3 flex items-center justify-center mx-auto mb-4">
            <Server size={28} className="text-text-dim" />
          </div>
          <h3 className="font-semibold text-text-primary mb-1">暂无供应商</h3>
          <p className="text-text-secondary text-sm mb-4">
            导入预设模板或手动添加一个供应商
          </p>
          <button
            onClick={() => setShowPreset(true)}
            className="btn btn-primary btn-sm"
          >
            <Plus size={14} />
            导入预设
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {providers.map((p) => (
            <ProviderCard key={p.name} provider={p} onSaved={refetch} />
          ))}
        </div>
      )}

      <PresetDialog
        open={showPreset}
        onClose={() => setShowPreset(false)}
        onImported={refetch}
      />
    </div>
  );
}
