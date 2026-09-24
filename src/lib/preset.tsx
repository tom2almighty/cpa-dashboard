import { createContext, type ReactNode, useContext, useState } from "react";
import type { Preset } from "@/lib/range";

const PresetContext = createContext<[Preset, (p: Preset) => void] | null>(null);

// 概览和用量页共用同一个时间范围,切换页面时保持不变
export function PresetProvider({ children }: { children: ReactNode }) {
  const state = useState<Preset>("today");
  return <PresetContext.Provider value={state}>{children}</PresetContext.Provider>;
}

export function usePreset() {
  const value = useContext(PresetContext);
  if (!value) throw new Error("usePreset 必须在 PresetProvider 内使用");
  return value;
}
