// src/components/models/ModelsPage.tsx
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { electronAPI } from "../../lib/api/ipc";
import { useProviders } from "../../hooks/useProviders";
import { Trash2, Plus, ArrowRight, GitBranch, Globe } from "lucide-react";

interface ModelRouteRow {
  codex_model: string;
  provider_id: string;
  vendor_model: string;
}

export default function ModelsPage() {
  const queryClient = useQueryClient();
  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: () => electronAPI.getConfig(),
    staleTime: 30000,
  });
  const { data: providers } = useProviders();

  const [newCodex, setNewCodex] = useState("");
  const [newProvider, setNewProvider] = useState("deepseek");
  const [newVendor, setNewVendor] = useState("");

  const modelMap = config?.model_map ?? {};
  const routes: ModelRouteRow[] = Object.entries(modelMap)
    .filter(([k]) => k !== "__default__")
    .map(([codex_model, value]) => {
      const colonIdx = value.indexOf(":");
      const provider_id = colonIdx > -1 ? value.substring(0, colonIdx) : "";
      const vendor_model = colonIdx > -1 ? value.substring(colonIdx + 1) : value;
      return { codex_model, provider_id, vendor_model };
    });

  const refetch = () => queryClient.invalidateQueries({ queryKey: ["config"] });

  const add = async () => {
    if (!newCodex.trim() || !newVendor.trim()) return;
    try {
      const cfg = await electronAPI.getConfig();
      cfg.model_map = cfg.model_map || {};
      cfg.model_map[newCodex.trim()] = `${newProvider}:${newVendor.trim()}`;
      const result = await electronAPI.updateConfig(cfg);
      if (!result.success && result.error) alert(result.error);
      else {
        setNewCodex("");
        setNewVendor("");
        refetch();
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (codex: string) => {
    try {
      const cfg = await electronAPI.getConfig();
      if (cfg.model_map) delete cfg.model_map[codex];
      const result = await electronAPI.updateConfig(cfg);
      if (!result.success && result.error) alert(result.error);
      else refetch();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const providerOptions =
    (providers ?? []).length > 0
      ? providers!.map((p) => ({ id: p.name, label: p.name }))
      : [
          { id: "deepseek", label: "DeepSeek" },
          { id: "siliconflow", label: "SiliconFlow" },
          { id: "qwen", label: "通义千问" },
          { id: "moonshot", label: "Moonshot" },
        ];

  return (
    <div className="max-w-[860px]">
      <div className="mb-6">
        <h2 className="text-[1.25rem] font-bold text-text-primary">模型路由</h2>
        <p className="text-[0.8rem] text-text-dim mt-0.5">
          将 Codex CLI 请求的模型名映射到上游供应商模型
        </p>
      </div>

      {/* Route table */}
      <div className="card overflow-hidden mb-4">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-surface-2/50">
              <th className="text-left px-4 py-2.5 text-[0.7rem] uppercase text-text-dim tracking-wider font-semibold border-b border-border">
                Codex 模型名
              </th>
              <th className="text-left px-4 py-2.5 text-[0.7rem] uppercase text-text-dim tracking-wider font-semibold border-b border-border">
                供应商
              </th>
              <th className="text-left px-4 py-2.5 text-[0.7rem] uppercase text-text-dim tracking-wider font-semibold border-b border-border">
                上游模型名
              </th>
              <th className="w-16 px-4 py-2.5 border-b border-border" />
            </tr>
          </thead>
          <tbody>
            {routes.map((r) => (
              <tr
                key={r.codex_model}
                className="border-b border-border hover:bg-surface-2/30 transition-colors"
              >
                <td className="px-4 py-2.5 font-mono text-[0.8rem]">
                  {r.codex_model}
                </td>
                <td className="px-4 py-2.5 text-text-secondary text-[0.8rem]">
                  <span className="flex items-center gap-1.5">
                    <Globe size={12} className="text-text-dim" />
                    {r.provider_id}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-mono text-[0.78rem] text-text-secondary">
                  {r.vendor_model}
                </td>
                <td className="px-4 py-2.5">
                  <button
                    onClick={() => remove(r.codex_model)}
                    className="btn btn-ghost btn-xs text-red hover:bg-red/10"
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
            {routes.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center py-12">
                  <GitBranch
                    size={28}
                    className="text-text-dim mx-auto mb-2"
                  />
                  <p className="text-text-dim text-sm">
                    暂无路由映射，在下方添加第一条规则
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add form */}
      <div className="card p-4">
        <h3 className="section-header">添加映射</h3>
        <div className="flex gap-3 items-end flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="text-[0.7rem] font-semibold uppercase text-text-dim">
              Codex 模型名
            </label>
            <input
              className="input w-36"
              value={newCodex}
              onChange={(e) => setNewCodex(e.target.value)}
              placeholder="gpt-5.1"
            />
          </div>
          <div className="flex items-center pt-4">
            <ArrowRight size={16} className="text-text-dim" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[0.7rem] font-semibold uppercase text-text-dim">
              供应商
            </label>
            <select
              className="input w-36"
              value={newProvider}
              onChange={(e) => setNewProvider(e.target.value)}
            >
              {providerOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center pt-4">
            <span className="text-text-dim text-sm font-mono">:</span>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[0.7rem] font-semibold uppercase text-text-dim">
              上游模型名
            </label>
            <input
              className="input w-44"
              value={newVendor}
              onChange={(e) => setNewVendor(e.target.value)}
              placeholder="deepseek-v4-pro"
            />
          </div>
          <button className="btn btn-primary btn-sm" onClick={add}>
            <Plus size={14} />
            添加
          </button>
        </div>
      </div>
    </div>
  );
}
