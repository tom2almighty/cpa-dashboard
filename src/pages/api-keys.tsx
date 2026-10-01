import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Eye, EyeOff, KeyRound, Pencil, Plus, Terminal, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n/context";
import { api, CONFIG_KEY, configPath, configQuery, errorText, storedBaseUrl } from "@/lib/api";

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

function getClientApiUrl(): string {
  const custom = storedBaseUrl();
  if (custom) return `${custom.replace(/\/+$/, "")}/v1`;

  const { protocol, hostname, port } = window.location;
  if (protocol === "https:") {
    const portSuffix = port && port !== "443" ? `:${port}` : "";
    return `https://${hostname}${portSuffix}/v1`;
  }

  const portSuffix = port && port !== "80" ? `:${port}` : "";
  return `http://${hostname}${portSuffix}/v1`;
}

function saveNotes(notes: Record<string, string>) {
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  } catch {}
}

export function ApiKeysPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState("");
  const [addingNote, setAddingNote] = useState("");
  // 记录刚复制的内容,用于把对应按钮切换成对勾
  const [copied, setCopied] = useState<string | null>(null);
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
  const { data, isPending, isError, error } = useQuery({
    ...configQuery,
    select: (c) => (c.access as { "api-keys"?: string[] } | undefined)?.["api-keys"] ?? [],
  });

  // 列表整体替换,删到空时写 [](空列表是合法值)
  const save = useMutation({
    mutationFn: (keys: string[]) => api(configPath("access", "api-keys"), { method: "PUT", body: keys }),
    onSuccess: () => {
      setAdding("");
      queryClient.invalidateQueries({ queryKey: CONFIG_KEY });
      toast.success(t("api_keys.updated"));
    },
  });
  const keys = data ?? [];

  // 生成与手动输入都走这里:点一次就写入列表,不用再点一次「添加密钥」
  const addKey = (candidate: string) => {
    const key = candidate.trim();
    if (!key || keys.includes(key)) return;
    save.mutate([...keys, key]);
    const note = addingNote.trim();
    if (!note) return;
    const next = { ...notes, [key]: note };
    setNotes(next);
    saveNotes(next);
    setAddingNote("");
  };

  const copy = (text: string, message: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(text);
        toast.success(message);
        setTimeout(() => setCopied(null), 2000);
      },
      () => toast.error(t("api_keys.copy_failed")),
    );
  };

  const cpaBaseUrl = getClientApiUrl();

  return (
    <>
      <PageHeader title={t("api_keys.title")} description={t("api_keys.desc")} />

      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
              {t("api_keys.base_url")}:
            </span>
            <div className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 min-w-0">
              <code className="truncate font-mono text-xs text-foreground font-semibold">{cpaBaseUrl}</code>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => copy(cpaBaseUrl, t("api_keys.copied_base_url"))}
                title={t("api_keys.copy_base_url")}
                aria-label={t("api_keys.copy_base_url")}
              >
                {copied === cpaBaseUrl ? <Check className="text-primary size-3.5" /> : <Copy className="size-3.5" />}
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {keys.length > 0 && (
              <Button variant="ghost" size="xs" onClick={toggleShowAll} className="text-muted-foreground">
                {showAll ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                {showAll ? t("api_keys.hide_all") : t("api_keys.show_all")}
              </Button>
            )}
            <Badge variant="secondary" className="tabular-nums">
              {t("api_keys.keys_count", { count: keys.length })}
            </Badge>
          </div>
        </div>
        {isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t("api_keys.load_failed", { message: errorText(error) })}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border min-w-0 overflow-hidden">
            {keys.map((key) => {
              const testCmd = `curl ${cpaBaseUrl}/models \\\n  -H "Authorization: Bearer ${key}"`;
              return (
                <li
                  key={key}
                  className="flex flex-col gap-2.5 px-3.5 py-2.5 sm:flex-row sm:items-center sm:gap-3 min-w-0 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                    <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <code className="truncate font-mono text-xs sm:text-sm min-w-0 flex-1">
                      {visibleKeys[key] ? key : maskKey(key)}
                    </code>
                    {notes[key] ? (
                      <Badge
                        variant="outline"
                        className="cursor-pointer text-xs font-normal hover:border-primary/60 shrink-0"
                        title={t("api_keys.click_to_edit_note")}
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
                        className="shrink-0 text-xs text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
                        onClick={() => {
                          setEditingNoteKey(key);
                          setEditingNoteValue("");
                        }}
                      >
                        {t("api_keys.add_note")}
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1 self-end sm:self-auto shrink-0">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={visibleKeys[key] ? t("api_keys.hide_key") : t("api_keys.show_key")}
                      title={visibleKeys[key] ? t("api_keys.hide_key") : t("api_keys.show_key")}
                      onClick={() => toggleVisible(key)}
                    >
                      {visibleKeys[key] ? <EyeOff /> : <Eye />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("api_keys.copy_key")}
                      title={t("api_keys.copy_key")}
                      onClick={() => copy(key, t("api_keys.copied_key"))}
                    >
                      {copied === key ? <Check className="text-primary" /> : <Copy />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("api_keys.test_connectivity_cmd")}
                      title={t("api_keys.test_connectivity_cmd")}
                      onClick={() => copy(testCmd, t("api_keys.copied_test_cmd"))}
                    >
                      {copied === testCmd ? <Check className="text-primary" /> : <Terminal />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("api_keys.edit_note")}
                      title={t("api_keys.edit_note")}
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
                      aria-label={`${t("common.delete")} ${key}`}
                      title={t("api_keys.delete_key")}
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
                  </div>
                </li>
              );
            })}
            {keys.length === 0 && (
              <li className="py-8 text-center text-sm text-muted-foreground">{t("api_keys.empty_keys")}</li>
            )}
          </ul>
        )}

        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            addKey(adding);
          }}
        >
          <Input
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            placeholder={t("api_keys.new_key_placeholder")}
            aria-label={t("api_keys.new_key_label")}
            className="w-full font-mono sm:w-72"
          />
          <Input
            value={addingNote}
            onChange={(e) => setAddingNote(e.target.value)}
            placeholder={t("api_keys.note_placeholder")}
            aria-label={t("api_keys.note_label")}
            className="w-full sm:w-56"
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1 sm:flex-none"
              disabled={!data || save.isPending}
              onClick={() => {
                const key = randomKey();
                // 失败时把生成的 key 留在输入框,可以直接重试「添加密钥」
                setAdding(key);
                addKey(key);
              }}
            >
              {t("api_keys.generate_and_add")}
            </Button>
            <Button type="submit" className="flex-1 sm:flex-none" disabled={!data || !adding.trim() || save.isPending}>
              <Plus />
              {t("api_keys.add_key")}
            </Button>
          </div>
        </form>
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
                toast.success(t("api_keys.note_saved"));
              }}
            >
              <DialogHeader>
                <DialogTitle>{t("api_keys.edit_note_title")}</DialogTitle>
              </DialogHeader>
              <div className="py-4 space-y-2">
                <code className="text-xs text-muted-foreground block font-mono">{maskKey(editingNoteKey)}</code>
                <Input
                  value={editingNoteValue}
                  onChange={(e) => setEditingNoteValue(e.target.value)}
                  placeholder={t("api_keys.edit_note_placeholder")}
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditingNoteKey(null)}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit">{t("api_keys.save_note")}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
