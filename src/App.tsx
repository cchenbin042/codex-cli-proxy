import { useState } from "react";
import Sidebar from "./components/layout/Sidebar";
import DashboardPage from "./components/dashboard/DashboardPage";
import ProvidersPage from "./components/providers/ProvidersPage";
import ModelsPage from "./components/models/ModelsPage";
import ReliabilityPage from "./components/reliability/ReliabilityPage";
import LogsPage from "./components/logs/LogsPage";
import CachePage from "./components/cache/CachePage";
import TracerPage from "./components/tracer/TracerPage";
import SettingsPage from "./components/settings/SettingsPage";

export type TabId =
  | "dashboard"
  | "providers"
  | "models"
  | "reliability"
  | "logs"
  | "cache"
  | "tracer"
  | "settings";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");

  return (
    <div className="flex h-screen">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="flex-1 overflow-y-auto p-8">
          {activeTab === "dashboard" && <DashboardPage />}
          {activeTab === "providers" && <ProvidersPage />}
          {activeTab === "models" && <ModelsPage />}
          {activeTab === "reliability" && <ReliabilityPage />}
          {activeTab === "logs" && <LogsPage />}
          {activeTab === "cache" && <CachePage />}
          {activeTab === "tracer" && <TracerPage />}
          {activeTab === "settings" && <SettingsPage />}
        </main>
    </div>
  );
}
