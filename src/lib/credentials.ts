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

/** 凭据的展示名：优先账号信息，最后回退到文件名 */
export function accountName(file: AuthFile): string {
  return file.email || file.label || file.account || file.name;
}

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
 * 凭据列表。
 *
 * loadAll 为 false（默认）时只拉第一页，服务端分页、筛选只作用于当前页，凭据再多
 * 也只发一个请求；为 true 时按服务端游标把后续页全部补齐，页面据此改用客户端分页
 * 与全局筛选，代价是内存与请求数随凭据数量增长。
 */
export function useCredentials({
  refetchInterval,
  loadAll = false,
}: {
  refetchInterval?: number;
  loadAll?: boolean;
} = {}) {
  const query = useInfiniteQuery({
    queryKey: CREDENTIALS_KEY,
    queryFn: ({ pageParam }) => fetchCredentialsPage(pageParam),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
    refetchInterval,
  });
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;

  useEffect(() => {
    if (loadAll && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, loadAll]);

  const pages = query.data?.pages ?? [];
  return { ...query, ...mergePages(pages), loadAll, isComplete: !hasNextPage };
}
