// src/components/layout/Sidebar.tsx
import { TabId } from "../../App";
import StatusFooter from "./StatusFooter";
import {
  LayoutDashboard,
  Box,
  GitBranch,
  Shield,
  ScrollText,
  Database,
  Search,
  Settings,
} from "lucide-react";

interface Props {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const NAV_ITEMS: { id: TabId; icon: typeof LayoutDashboard; label: string }[] = [
  { id: "dashboard", icon: LayoutDashboard, label: "仪表盘" },
  { id: "providers", icon: Box, label: "供应商" },
  { id: "models", icon: GitBranch, label: "模型路由" },
  { id: "reliability", icon: Shield, label: "可靠性" },
  { id: "logs", icon: ScrollText, label: "请求日志" },
  { id: "cache", icon: Database, label: "缓存" },
  { id: "tracer", icon: Search, label: "链路追踪" },
  { id: "settings", icon: Settings, label: "设置" },
];

export default function Sidebar({ activeTab, onTabChange }: Props) {
  return (
    <nav className="w-[220px] min-w-[220px] bg-surface border-r border-border flex flex-col select-none">
      {/* Brand */}
      <div className="px-4 py-4 flex items-center gap-3 border-b border-border">
        <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
          <span className="text-white font-bold text-sm">CX</span>
        </div>
        <div>
          <div className="font-semibold text-[0.9rem] text-text-primary leading-tight">
            codex-proxy
          </div>
          <div className="text-[0.65rem] text-text-dim">Codex 多模型代理</div>
        </div>
      </div>

      {/* Nav Items */}
      <div className="flex-1 px-3 py-4 flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`nav-item ${isActive ? "nav-item-active" : ""}`}
            >
              <Icon size={18} strokeWidth={isActive ? 2.5 : 1.8} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      <StatusFooter />
    </nav>
  );
}
