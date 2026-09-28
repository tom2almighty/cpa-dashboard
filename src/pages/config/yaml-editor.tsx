import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { ChevronDown, ChevronUp, RotateCcw, Save, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CodeEditor } from "@/components/code-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n/context";
import { api, CONFIG_KEY } from "@/lib/api";

// 挂在 CONFIG_KEY 前缀下,任何配置写入后 invalidate CONFIG_KEY 都会一并刷新
const YAML_KEY = [...CONFIG_KEY, "yaml"];
const fetchYaml = () => api<string>("/v8/management/config.yaml");

export function YamlEditor() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const editorRef = useRef<ReactCodeMirrorRef | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: YAML_KEY,
    queryFn: fetchYaml,
    refetchOnWindowFocus: false,
  });

  // base 是当前编辑所基于的服务器版本;有未保存修改时,后台刷新不覆盖草稿
  const [base, setBase] = useState<string>();
  const [draft, setDraft] = useState("");
  const [seen, setSeen] = useState<string>();
  const dirty = base !== undefined && draft !== base;
  if (data !== undefined && data !== seen) {
    setSeen(data);
    if (!dirty) {
      setBase(data);
      setDraft(data);
    }
  }
  const discard = () => {
    if (data === undefined) return;
    setBase(data);
    setDraft(data);
  };

  // 搜索相关状态
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ current: number; total: number }>({
    current: 0,
    total: 0,
  });

  const save = useMutation({
    mutationFn: async () => {
      // 服务端没有 ETag,保存前比对一次,文件已被别处修改就放弃,避免覆盖
      const current = await fetchYaml();
      if (current !== base) {
        queryClient.setQueryData(YAML_KEY, current);
        throw new Error(t("config.yaml.conflict"));
      }
      const body = draft;
      await api("/v8/management/config.yaml", {
        method: "PUT",
        body,
        raw: true,
        headers: { "Content-Type": "application/yaml" },
      });
      return body;
    },
    onSuccess: (saved) => {
      // 服务端会哈希密钥、规范化布局,以刷新后的内容为准
      setBase(saved);
      queryClient.invalidateQueries({ queryKey: CONFIG_KEY });
      toast.success(t("config.save_success"));
    },
  });

  // 文档内代码搜索与光标选中
  const performSearch = useCallback((query: string, direction: "next" | "prev" = "next") => {
    if (!query || !editorRef.current?.view) return;

    const view = editorRef.current.view;
    const doc = view.state.doc.toString();
    const matches: number[] = [];
    const lowerQuery = query.toLowerCase();
    const lowerDoc = doc.toLowerCase();

    let pos = 0;
    while (pos < lowerDoc.length) {
      const index = lowerDoc.indexOf(lowerQuery, pos);
      if (index === -1) break;
      matches.push(index);
      pos = index + 1;
    }

    if (matches.length === 0) {
      setSearchResults({ current: 0, total: 0 });
      return;
    }

    const selection = view.state.selection.main;
    const cursorPos = direction === "prev" ? selection.from : selection.to;
    let currentIndex = 0;

    if (direction === "next") {
      for (let i = 0; i < matches.length; i++) {
        if (matches[i] > cursorPos) {
          currentIndex = i;
          break;
        }
        if (i === matches.length - 1) {
          currentIndex = 0;
        }
      }
    } else {
      for (let i = matches.length - 1; i >= 0; i--) {
        if (matches[i] < cursorPos) {
          currentIndex = i;
          break;
        }
        if (i === 0) {
          currentIndex = matches.length - 1;
        }
      }
    }

    const matchPos = matches[currentIndex];
    setSearchResults({ current: currentIndex + 1, total: matches.length });

    view.dispatch({
      selection: { anchor: matchPos, head: matchPos + query.length },
      scrollIntoView: true,
    });
  }, []);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (!value) {
      setSearchResults({ current: 0, total: 0 });
    } else {
      performSearch(value, "next");
    }
  };

  const handleNext = () => {
    if (!searchQuery) return;
    performSearch(searchQuery, "next");
  };

  const handlePrev = () => {
    if (!searchQuery) return;
    performSearch(searchQuery, "prev");
  };

  // 监听 Ctrl/Cmd + F 快捷键聚焦搜索框
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("config.yaml.load_failed", { message: error.message })}
      </p>
    );
  }
  if (isPending) return <Skeleton className="h-[65svh]" />;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {/* 代码搜索工具栏 */}
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (e.shiftKey) handlePrev();
                  else handleNext();
                }
              }}
              placeholder={t("config.yaml.search_placeholder")}
              className="h-8 pl-8 pr-16 text-xs font-mono"
            />
            {searchQuery && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <span className="text-[11px] tabular-nums text-muted-foreground font-mono">
                  {searchResults.total > 0
                    ? `${searchResults.current}/${searchResults.total}`
                    : t("config.yaml.no_match")}
                </span>
                <button
                  type="button"
                  onClick={() => handleSearchChange("")}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={t("config.yaml.clear_search")}
                >
                  <X className="size-3" />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              title={`${t("config.yaml.prev_match")} (Shift+Enter)`}
              aria-label={t("config.yaml.prev_match")}
              disabled={!searchQuery || searchResults.total === 0}
              onClick={handlePrev}
            >
              <ChevronUp className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              title={`${t("config.yaml.next_match")} (Enter)`}
              aria-label={t("config.yaml.next_match")}
              disabled={!searchQuery || searchResults.total === 0}
              onClick={handleNext}
            >
              <ChevronDown className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* 撤销修改与保存操作 */}
        <div className="flex items-center gap-2">
          <p className="hidden text-xs text-muted-foreground lg:block">{t("config.yaml.save_hint")}</p>
          <Button
            variant="outline"
            size="sm"
            disabled={!dirty || save.isPending}
            onClick={discard}
            className="h-8 text-xs"
          >
            <RotateCcw className="size-3.5" />
            {t("config.discard")}
          </Button>
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()} className="h-8 text-xs">
            {save.isPending ? <Spinner className="size-3.5" /> : <Save className="size-3.5" />}
            {t("config.save_changes")}
          </Button>
        </div>
      </div>

      <CodeEditor
        editorRef={editorRef}
        label="config.yaml"
        language="yaml"
        height="65svh"
        value={draft}
        onChange={setDraft}
        onSave={() => dirty && !save.isPending && save.mutate()}
      />
    </>
  );
}
