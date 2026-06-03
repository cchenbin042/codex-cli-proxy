// src/components/dashboard/ProviderGrid.tsx
import { useProviders } from "../../hooks/useProviders";
import { CheckCircle2, MinusCircle, PackageOpen } from "lucide-react";

export default function ProviderGrid() {
  const { data: providers, isLoading } = useProviders();
  const list = providers ?? [];

  const displayList = list.map((p) => ({
    name: p.name,
    label: p.name,
    enabled: p.enabled,
    isDefault: p.is_default,
  }));

  return (
    <div className="card p-5">
      <h3 className="section-header">供应商状态</h3>
      {isLoading ? (
        <p className="text-text-dim text-sm py-6 text-center">加载中...</p>
      ) : displayList.length === 0 ? (
        <div className="flex flex-col items-center py-10 text-text-dim">
          <PackageOpen size={32} className="mb-2" />
          <p className="text-sm">暂无供应商，请在"供应商"页面添加</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        {displayList.map((p) => (
          <div
            key={p.name}
            className={`bg-surface-2 border rounded-lg p-3.5 transition-colors ${
              p.enabled
                ? "border-green/20"
                : "border-border hover:border-border-light"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-[0.85rem]">{p.label}</span>
              {"isDefault" in p && p.isDefault && (
                <span className="badge badge-accent">默认</span>
              )}
            </div>
            <div
              className={`flex items-center gap-1.5 text-[0.75rem] ${
                p.enabled ? "text-green" : "text-text-dim"
              }`}
            >
              {p.enabled ? (
                <CheckCircle2 size={13} />
              ) : (
                <MinusCircle size={13} />
              )}
              {p.enabled ? "已启用" : "未配置"}
            </div>
          </div>
        ))}
        </div>
      )}
    </div>
  );
}
