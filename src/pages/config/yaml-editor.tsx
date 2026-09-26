import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CodeEditor } from "@/components/code-editor";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";

export function YamlEditor() {
  const queryClient = useQueryClient();
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["cpa", "config.yaml"],
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
      queryClient.setQueryData(["cpa", "config.yaml"], draft);
      queryClient.invalidateQueries({ queryKey: ["cpa", "config"] });
      toast.success("配置已保存，CPA 会自动重新加载");
    },
  });

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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">保存时 CPA 会先校验格式，Ctrl/⌘ + S 保存。</p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={!dirty || save.isPending} onClick={() => setDraft(data)}>
            <RotateCcw />
            撤销修改
          </Button>
          <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Spinner /> : <Save />}
            保存
          </Button>
        </div>
      </div>
      <CodeEditor
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
