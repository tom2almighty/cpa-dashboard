import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Plus, Terminal, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, setClientKey } from "@/lib/api";

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `sk-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function ApiKeysPage() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ["cpa", "api-keys"],
    queryFn: () => api<{ "api-keys": string[] }>("/v0/management/api-keys"),
    select: (res) => res["api-keys"] ?? [],
  });

  const save = useMutation({
    mutationFn: (keys: string[]) => api("/v0/management/api-keys", { method: "PUT", body: keys }),
    onSuccess: () => {
      setAdding("");
      queryClient.invalidateQueries({ queryKey: ["cpa", "api-keys"] });
      queryClient.invalidateQueries({ queryKey: ["cpa", "config.yaml"] });
      toast.success("API Key 已更新");
    },
  });

  const keys = data ?? [];

  useEffect(() => {
    if (keys.length > 0) {
      setClientKey(keys[0]);
    }
  }, [keys]);

  const copy = (text: string, isKey = true) => {
    navigator.clipboard.writeText(text).then(() => {
      if (isKey) {
        setCopiedKey(text);
        toast.success("已复制 API Key");
        setTimeout(() => setCopiedKey(null), 2000);
      } else {
        setCopiedUrl(true);
        toast.success("已复制接口地址");
        setTimeout(() => setCopiedUrl(false), 2000);
      }
    });
  };

  const cpaBaseUrl = `${window.location.protocol}//${window.location.hostname}:8317/v1`;
  const firstKey = keys[0] || "sk-your-api-key";

  return (
    <>
      <PageHeader
        title="客户端 API Key"
        description="管理客户端（Cursor、Cline、Chatbox、OpenAI SDK 等）调用 CPA 的 /v1 接口时使用的凭据。"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>已配置的 Key</CardTitle>
                  <CardDescription className="mt-1">
                    CPA 启动后会校验传入的 Bearer Token 是否包含在以下列表中。
                  </CardDescription>
                </div>
                {keys.length > 0 && (
                  <Badge variant="secondary" className="tabular-nums">
                    {keys.length} 个 Key
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {isPending ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <ul className="divide-y rounded-lg border">
                  {keys.map((key) => (
                    <li key={key} className="flex items-center gap-3 px-3 py-2.5">
                      <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <code className="min-w-0 flex-1 truncate font-mono text-sm">{key}</code>
                      <Button variant="ghost" size="icon-xs" aria-label="复制 Key" onClick={() => copy(key)}>
                        {copiedKey === key ? <Check className="text-primary" /> : <Copy />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`删除 ${key}`}
                        className="text-muted-foreground hover:text-destructive"
                        disabled={save.isPending}
                        onClick={() => save.mutate(keys.filter((k) => k !== key))}
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                  {keys.length === 0 && (
                    <li className="py-8 text-center text-sm text-muted-foreground">
                      还没有配置客户端 API Key。若留空，部分客户端请求可能会被拒绝。
                    </li>
                  )}
                </ul>
              )}

              <form
                className="mt-4 flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const key = adding.trim();
                  if (key && !keys.includes(key)) save.mutate([...keys, key]);
                }}
              >
                <Input
                  value={adding}
                  onChange={(e) => setAdding(e.target.value)}
                  placeholder="输入或生成一个新的 Key"
                  aria-label="新的 API Key"
                  className="w-full font-mono sm:w-80"
                />
                <Button type="button" variant="outline" onClick={() => setAdding(randomKey())}>
                  随机生成
                </Button>
                <Button type="submit" disabled={!adding.trim() || save.isPending}>
                  <Plus />
                  添加 Key
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Terminal className="size-4" />
                快速接入指南
              </CardTitle>
              <CardDescription>在任意 OpenAI 兼容客户端中填入以下信息即可接入：</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <span className="text-xs font-medium text-muted-foreground">Base URL (接口地址)</span>
                <div className="mt-1 flex items-center justify-between gap-2 rounded-md border bg-muted/50 px-3 py-1.5">
                  <code className="truncate font-mono text-xs">{cpaBaseUrl}</code>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => copy(cpaBaseUrl, false)}
                    aria-label="复制接口地址"
                  >
                    {copiedUrl ? <Check className="text-primary" /> : <Copy />}
                  </Button>
                </div>
              </div>

              <div>
                <span className="text-xs font-medium text-muted-foreground">测试接口连通性 (cURL)</span>
                <pre className="mt-1 overflow-x-auto rounded-md border bg-muted/50 p-2.5 font-mono text-xs text-muted-foreground">
                  <code>{`curl ${cpaBaseUrl}/models \\\n  -H "Authorization: Bearer ${firstKey}"`}</code>
                </pre>
              </div>

              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                <p>
                  可在{" "}
                  <Link to="/models" className="font-medium text-foreground underline underline-offset-2">
                    模型页面
                  </Link>{" "}
                  查看当前 CPA 挂载支持的具体模型 ID 列表。
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
