// src/hooks/useConfig.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { electronAPI, AppConfig } from "../lib/api/ipc";

export function useConfig() {
  return useQuery<AppConfig>({
    queryKey: ["config"],
    queryFn: () => electronAPI.getConfig(),
    staleTime: 30000,
  });
}

export function useUpdateConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (config: AppConfig) => electronAPI.updateConfig(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config"] });
    },
  });
}
