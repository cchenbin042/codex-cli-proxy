// src/hooks/useBackendStatus.ts
import { useState, useEffect } from "react";
import { electronAPI, BackendInfo } from "../lib/api/ipc";

const DEFAULT: BackendInfo = {
  status: "stopped",
  port: 8317,
  pid: null,
  uptime: 0,
  startTime: null,
  consecutiveHealthFailures: 0,
};

export function useBackendStatus() {
  const [info, setInfo] = useState<BackendInfo>(DEFAULT);

  useEffect(() => {
    // Fetch initial status
    electronAPI.getBackendStatus().then(setInfo).catch(() => {});

    // Subscribe to status changes
    const unsub = electronAPI.onBackendStatus((newInfo) => {
      setInfo(newInfo);
    });

    return unsub;
  }, []);

  const isRunning = info.status === "running";
  const isStarting = info.status === "starting";
  const isStopping = info.status === "stopping";
  const isError = info.status === "error";
  const isStopped = info.status === "stopped";

  return {
    ...info,
    isRunning,
    isStarting,
    isStopping,
    isError,
    isStopped,
  };
}
