import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePreset } from "@/lib/preset";
import { rangeQuery, resolveRange, tzOffsetMinutes } from "@/lib/range";
import type { BreakdownBy, BreakdownRow, TimePoint, Totals, UsageEvent } from "@/lib/types";

const REFRESH_MS = 30_000;

// 时间范围在 queryFn 里现算,自动刷新时能拿到最新数据
export function useSummary() {
  const [preset] = usePreset();
  return useQuery({
    queryKey: ["usage", "summary", preset],
    queryFn: () => api<Totals>(`/api/usage/summary?${rangeQuery(resolveRange(preset))}`),
    refetchInterval: REFRESH_MS,
    placeholderData: keepPreviousData,
  });
}

export function useTimeseries() {
  const [preset] = usePreset();
  return useQuery({
    queryKey: ["usage", "timeseries", preset],
    queryFn: async () => {
      const range = resolveRange(preset);
      const points = await api<TimePoint[]>(
        `/api/usage/timeseries?${rangeQuery(range, { bucket: range.bucket, tz: tzOffsetMinutes() })}`,
      );
      return { bucket: range.bucket, points };
    },
    refetchInterval: REFRESH_MS,
    placeholderData: keepPreviousData,
  });
}

export function useBreakdown(by: BreakdownBy) {
  const [preset] = usePreset();
  return useQuery({
    queryKey: ["usage", "breakdown", preset, by],
    queryFn: () => api<BreakdownRow[]>(`/api/usage/breakdown?${rangeQuery(resolveRange(preset), { by })}`),
    refetchInterval: REFRESH_MS,
    placeholderData: keepPreviousData,
  });
}

export type EventFilters = { model?: string; account?: string; apiKey?: string; status?: string };

export function useEvents(filters: EventFilters, page: number, pageSize: number) {
  const [preset] = usePreset();
  return useQuery({
    queryKey: ["usage", "events", preset, filters, page, pageSize],
    queryFn: () =>
      api<{ total: number; items: UsageEvent[] }>(
        `/api/usage/events?${rangeQuery(resolveRange(preset), { ...filters, limit: pageSize, offset: page * pageSize })}`,
      ),
    placeholderData: keepPreviousData,
  });
}
