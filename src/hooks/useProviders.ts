// src/hooks/useProviders.ts
import { useQuery } from "@tanstack/react-query";
import { electronAPI, AppConfig } from "../lib/api/ipc";

export interface ProviderEntry {
  name: string;
  api_base: string;
  enabled: boolean;
  is_default: boolean;
  api_keys: string[];
}

function configToProviders(config: AppConfig): ProviderEntry[] {
  const defaultProvider = config.model_map?.["__default__"] || "";
  return Object.entries(config.providers || {}).map(([name, pcfg]) => ({
    name,
    api_base: pcfg.api_base,
    enabled: pcfg.enabled,
    is_default: name === defaultProvider,
    api_keys: pcfg.api_keys || [],
  }));
}

export function useProviders() {
  return useQuery({
    queryKey: ["providers"],
    queryFn: async () => {
      const config = await electronAPI.getConfig();
      return configToProviders(config);
    },
    refetchInterval: 5000,
    initialData: [],
  });
}

// Re-export for components that need to save/delete providers via config
export { electronAPI } from "../lib/api/ipc";
