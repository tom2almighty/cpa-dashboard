import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";

const QUERY_KEY = ["cpa", "config.yaml"];

export function ConfigPage() {
  const queryClient = useQueryClient();
  const { data, isPending, isError, error } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api<string>("/v0/management/config.yaml"),
    refetchOnWindowFocus: false,
  });
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (data !== undefined) setDraft(data);
  }, [data]);

  const dirty = data !== undefined && draft !== data;

  const save = useMutation({
    mutationFn: () =>
      api("/v0/management/config.yaml", {
        method: "PUT",
        body: draft,
        raw: true,
        headers: { "Content-Type": "application/yaml" },
      }),
    onSuccess: () => {
      queryClient.setQueryData(QUERY_KEY, draft);
      toast.success("配置已保存，CPA 会自动重新加载");
    },
  });

  return (
    <>
      <PageHeader
        title="配置文件"
        description="直接编辑 CPA 的 config.yaml，保存前 CPA 会校验格式。"
        actions={
          <>
            <Button variant="outline" disabled={!dirty || save.isPending} onClick={() => data && setDraft(data)}>
              <RotateCcw />
              撤销修改
            </Button>
            <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? <Spinner /> : <Save />}
              保存
            </Button>
          </>
        }
      />
      {isError ? (
        <p role="alert" className="text-sm text-destructive">
          读取配置失败：{error.message}
        </p>
      ) : isPending ? (
        <Skeleton className="h-[70svh]" />
      ) : (
        <Textarea
          aria-label="config.yaml"
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "s") {
              e.preventDefault();
              if (dirty && !save.isPending) save.mutate();
            }
          }}
          className="h-[70svh] resize-none [field-sizing:fixed] font-mono text-[13px] leading-relaxed"
        />
      )}
    </>
  );
}
