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
import { api } from "@/lib/api";

export function YamlEditor() {
  const queryClient = useQueryClient();
  const editorRef = useRef<ReactCodeMirrorRef | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["cpa", "config.yaml"],
    queryFn: () => api<string>("/v8/management/config.yaml"),
    refetchOnWindowFocus: false,
  });

  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (data !== undefined) setDraft(data);
  }, [data]);
  const dirty = data !== undefined && draft !== data;

  // 搜索相关状态
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ current: number; total: number }>({
    current: 0,
    total: 0,
  });

  const save = useMutation({
    mutationFn: () =>
      api("/v8/management/config.yaml", {
        method: "PUT",
        body: draft,
        raw: true,
        headers: { "Content-Type": "application/yaml" },
      }),
    onSuccess: () => {
      queryClient.setQueryData(["cpa", "config.yaml"], draft);
      queryClient.invalidateQueries({ queryKey: ["cpa", "config"] });
      toast.success("配置已保存，CPA 会自动重新加载");
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
        读取配置失败：{error.message}
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
              placeholder="搜索代码配置 (Enter 下一个，Ctrl+F)..."
              className="h-8 pl-8 pr-16 text-xs font-mono"
            />
            {searchQuery && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <span className="text-[11px] tabular-nums text-muted-foreground font-mono">
                  {searchResults.total > 0 ? `${searchResults.current}/${searchResults.total}` : "无匹配"}
                </span>
                <button
                  type="button"
                  onClick={() => handleSearchChange("")}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="清空搜索"
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
              title="上一个匹配项 (Shift+Enter)"
              aria-label="上一个匹配项"
              disabled={!searchQuery || searchResults.total === 0}
              onClick={handlePrev}
            >
              <ChevronUp className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              title="下一个匹配项 (Enter)"
              aria-label="下一个匹配项"
              disabled={!searchQuery || searchResults.total === 0}
              onClick={handleNext}
            >
              <ChevronDown className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* 撤销修改与保存操作 */}
        <div className="flex items-center gap-2">
          <p className="hidden text-xs text-muted-foreground lg:block">Ctrl/⌘ + S 保存配置</p>
          <Button
            variant="outline"
            size="sm"
            disabled={!dirty || save.isPending}
            onClick={() => setDraft(data)}
            className="h-8 text-xs"
          >
            <RotateCcw className="size-3.5" />
            撤销修改
          </Button>
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()} className="h-8 text-xs">
            {save.isPending ? <Spinner className="size-3.5" /> : <Save className="size-3.5" />}
            保存配置
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
