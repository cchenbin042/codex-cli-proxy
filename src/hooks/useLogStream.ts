// src/hooks/useLogStream.ts
import { useState, useEffect, useCallback, useRef } from "react";
import { electronAPI, LogEntry } from "../lib/api/ipc";

const MAX_ENTRIES = 5000;

export type LogLevel = "ALL" | "INFO" | "WARN" | "ERROR" | "DEBUG";

export function useLogStream() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<LogLevel>("ALL");
  const [search, setSearch] = useState("");
  const bufferRef = useRef<LogEntry[]>([]);

  // Subscribe to log stream
  useEffect(() => {
    const unsub = electronAPI.onLogEntry((entry) => {
      if (paused) {
        bufferRef.current.push(entry);
      } else {
        setEntries((prev) => {
          const next = [...prev, entry];
          return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
        });
      }
    });

    return unsub;
  }, [paused]);

  // Resume: flush buffer
  const resume = useCallback(() => {
    setPaused(false);
    if (bufferRef.current.length > 0) {
      setEntries((prev) => {
        const next = [...prev, ...bufferRef.current];
        bufferRef.current = [];
        return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
      });
    }
  }, []);

  const togglePause = useCallback(() => {
    setPaused((p) => {
      if (p) {
        // Will resume via useEffect dependency change
        return false;
      }
      return true;
    });
  }, []);

  const clear = useCallback(() => {
    setEntries([]);
    bufferRef.current = [];
  }, []);

  // Derived: filtered + searched entries (render only last 200)
  const displayed = entries
    .filter((e) => (filter === "ALL" ? true : e.level === filter))
    .filter((e) => (search ? e.message.toLowerCase().includes(search.toLowerCase()) : true))
    .slice(-200);

  return {
    entries,
    displayed,
    paused,
    filter,
    search,
    setFilter,
    setSearch,
    togglePause,
    resume,
    clear,
  };
}
