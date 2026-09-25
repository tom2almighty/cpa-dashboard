import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Eye, EyeOff, KeyRound, Pencil, Plus, Terminal, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `sk-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
const NOTES_KEY = "cpa-dashboard.api-key-notes";

function loadNotes(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveNotes(notes: Record<string, string>) {
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  } catch {}
}

export function ApiKeysPage() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState("");
  const [addingNote, setAddingNote] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>(() => loadNotes());
  const [editingNoteKey, setEditingNoteKey] = useState<string | null>(null);
  const [editingNoteValue, setEditingNoteValue] = useState("");

  const toggleVisible = (k: string) => {
    setVisibleKeys((prev) => ({ ...prev, [k]: !prev[k] }));
  };

  const toggleShowAll = () => {
    const next = !showAll;
    setShowAll(next);
    const map: Record<string, boolean> = {};
    for (const k of keys) map[k] = next;
    setVisibleKeys(map);
  };

  const maskKey = (key: string) => {
    if (key.length <= 8) return "••••••••";
    return `${key.slice(0, 4)}••••••••••••${key.slice(-4)}`;
  };
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
                <div className="flex items-center gap-2">
                  {keys.length > 0 && (
                    <Button variant="ghost" size="xs" onClick={toggleShowAll} className="text-muted-foreground">
                      {showAll ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      {showAll ? "全部隐藏" : "全部显示"}
                    </Button>
                  )}
                  {keys.length > 0 && (
                    <Badge variant="secondary" className="tabular-nums">
                      {keys.length} 个 Key
                    </Badge>
                  )}
                </div>
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
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <code className="truncate font-mono text-sm">{visibleKeys[key] ? key : maskKey(key)}</code>
                        {notes[key] ? (
                          <Badge
                            variant="outline"
                            className="cursor-pointer text-xs font-normal hover:border-primary/60 shrink-0"
                            title="点击修改备注"
                            onClick={() => {
                              setEditingNoteKey(key);
                              setEditingNoteValue(notes[key] || "");
                            }}
                          >
                            {notes[key]}
                          </Badge>
                        ) : (
                          <button
                            type="button"
                            className="shrink-0 text-xs text-muted-foreground hover:text-foreground hover:underline"
                            onClick={() => {
                              setEditingNoteKey(key);
                              setEditingNoteValue("");
                            }}
                          >
                            + 备注
                          </button>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={visibleKeys[key] ? "隐藏 Key" : "显示 Key"}
                        onClick={() => toggleVisible(key)}
                      >
                        {visibleKeys[key] ? <EyeOff /> : <Eye />}
                      </Button>
                      <Button variant="ghost" size="icon-xs" aria-label="复制 Key" onClick={() => copy(key)}>
                        {copiedKey === key ? <Check className="text-primary" /> : <Copy />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="修改备注"
                        onClick={() => {
                          setEditingNoteKey(key);
                          setEditingNoteValue(notes[key] || "");
                        }}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`删除 ${key}`}
                        className="text-muted-foreground hover:text-destructive"
                        disabled={save.isPending}
                        onClick={() => {
                          save.mutate(keys.filter((k) => k !== key));
                          if (notes[key]) {
                            const next = { ...notes };
                            delete next[key];
                            setNotes(next);
                            saveNotes(next);
                          }
                        }}
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
                  if (key && !keys.includes(key)) {
                    save.mutate([...keys, key]);
                    if (addingNote.trim()) {
                      const next = { ...notes, [key]: addingNote.trim() };
                      setNotes(next);
                      saveNotes(next);
                      setAddingNote("");
                    }
                  }
                }}
              >
                <Input
                  value={adding}
                  onChange={(e) => setAdding(e.target.value)}
                  placeholder="输入或生成一个新的 Key"
                  aria-label="新的 API Key"
                  className="w-full font-mono sm:w-72"
                />
                <Input
                  value={addingNote}
                  onChange={(e) => setAddingNote(e.target.value)}
                  placeholder="备注（例如：Cursor、生产环境）"
                  aria-label="Key 备注"
                  className="w-full sm:w-48"
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

      {editingNoteKey && (
        <Dialog open onOpenChange={(open) => !open && setEditingNoteKey(null)}>
          <DialogContent className="sm:max-w-sm">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const next = { ...notes };
                if (editingNoteValue.trim()) {
                  next[editingNoteKey] = editingNoteValue.trim();
                } else {
                  delete next[editingNoteKey];
                }
                setNotes(next);
                saveNotes(next);
                setEditingNoteKey(null);
                toast.success("备注已保存");
              }}
            >
              <DialogHeader>
                <DialogTitle>修改 API Key 备注</DialogTitle>
              </DialogHeader>
              <div className="py-4 space-y-2">
                <code className="text-xs text-muted-foreground block font-mono">{maskKey(editingNoteKey)}</code>
                <Input
                  value={editingNoteValue}
                  onChange={(e) => setEditingNoteValue(e.target.value)}
                  placeholder="输入备注，例如：Cursor、开发测试"
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditingNoteKey(null)}>
                  取消
                </Button>
                <Button type="submit">保存备注</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
