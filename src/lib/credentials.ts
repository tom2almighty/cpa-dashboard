import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "./api";
import type { AuthFile } from "./types";

// CPA GET /credentials 的分页响应:未启用分页时只有 files 与 observed_at
export type CredentialsPage = {
  files?: AuthFile[];
  observed_at?: string;
  total?: number;
  page?: number;
  page_size?: number;
  has_more?: boolean;
};

// 每页 200 条:常见部署一页装完,凭据很多时也不会一次拉全量
const PAGE_SIZE = 200;

export const CREDENTIALS_KEY = ["cpa", "credentials"] as const;

export function nextPageParam(last: CredentialsPage, pages: CredentialsPage[]): number | undefined {
  return last.has_more ? pages.length + 1 : undefined;
}

export function mergePages(pages: CredentialsPage[]): { files: AuthFile[]; total: number } {
  const files = pages.flatMap((page) => page.files ?? []);
  return { files, total: pages[0]?.total ?? files.length };
}

export async function fetchCredentialsPage(page: number): Promise<CredentialsPage> {
  const res = await api<CredentialsPage>(`/v8/management/credentials?page=${page}&page_size=${PAGE_SIZE}`);
  return { ...res, files: res.files ?? [] };
}

/**
 * 凭据列表:首屏只等第一页,剩余分页在后台顺序补齐。
 * 补齐过程中 files 会增长,页面按"已加载"的部分渲染;isComplete 为 true 时才是完整集合。
 */
export function useCredentials({ refetchInterval }: { refetchInterval?: number } = {}) {
  const query = useInfiniteQuery({
    queryKey: CREDENTIALS_KEY,
    queryFn: ({ pageParam }) => fetchCredentialsPage(pageParam),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
    refetchInterval,
  });
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;

  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const pages = query.data?.pages ?? [];
  return { ...query, ...mergePages(pages), isComplete: !hasNextPage };
}
