import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Settings2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CodeEditor } from "@/components/code-editor";
import { PageHeader } from "@/components/page-header";
import { EmptyRow, SkeletonRows } from "@/components/table-rows";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";

type Plugin = {
  id: string;
  registered?: boolean;
  enabled?: boolean;
  effective_enabled?: boolean;
  metadata?: { name?: string; version?: string; author?: string; github_repository?: string };
};

type PluginsResponse = { plugins_enabled?: boolean; plugins_dir?: string; plugins?: Plugin[] };

type StorePlugin = {
  store_id: string;
  source_id: string;
  source_name?: string;
  id: string;
  name?: string;
  description?: string;
  author?: string;
  version?: string;
  installed?: boolean;
  installed_version?: string;
  update_available?: boolean;
};

type StoreResponse = { sources?: { id: string; name?: string; error?: string }[]; plugins?: StorePlugin[] };

const PLUGINS_KEY = ["cpa", "plugins"];

function ConfigDialog({ plugin, onClose }: { plugin: Plugin | null; onClose: () => void }) {
  const [draft, setDraft] = useState("");
  const { data, isPending } = useQuery({
    queryKey: ["cpa", "plugin-config", plugin?.id],
    queryFn: () => api<unknown>(`/v0/management/plugins/${encodeURIComponent(plugin?.id ?? "")}/config`),
    enabled: plugin !== null,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (data !== undefined) setDraft(JSON.stringify(data, null, 2));
  }, [data]);

  const save = useMutation({
    mutationFn: () => {
      const value = JSON.parse(draft) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("配置必须是 JSON 对象");
      return api(`/v0/management/plugins/${encodeURIComponent(plugin?.id ?? "")}/config`, {
        method: "PUT",
        body: value,
      });
    },
    onSuccess: () => {
      toast.success("插件配置已保存");
      onClose();
    },
  });

  return (
    <Dialog open={plugin !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{plugin?.metadata?.name || plugin?.id} 配置</DialogTitle>
        </DialogHeader>
        {isPending ? (
          <Skeleton className="h-80" />
        ) : (
          <CodeEditor
            label="插件配置"
            language="json"
            height="20rem"
            value={draft}
            onChange={setDraft}
            onSave={() => save.mutate()}
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => save.mutate()} disabled={isPending || save.isPending}>
            {save.isPending && <Spinner />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Installed() {
  const queryClient = useQueryClient();
  const [configuring, setConfiguring] = useState<Plugin | null>(null);
  const [deleting, setDeleting] = useState<Plugin | null>(null);
  const { data, isPending, isError, error } = useQuery({
    queryKey: PLUGINS_KEY,
    queryFn: () => api<PluginsResponse>("/v0/management/plugins"),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: PLUGINS_KEY });

  const toggle = useMutation({
    mutationFn: (p: Plugin) =>
      api(`/v0/management/plugins/${encodeURIComponent(p.id)}/enabled`, {
        method: "PATCH",
        body: { enabled: !p.enabled },
      }),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (p: Plugin) =>
      api<{ restart_required?: boolean }>(`/v0/management/plugins/${encodeURIComponent(p.id)}`, { method: "DELETE" }),
    onSuccess: (res, p) => {
      toast.success(res.restart_required ? `已删除 ${p.id}，重启 CPA 后生效` : `已删除 ${p.id}`);
      setDeleting(null);
      refresh();
    },
  });

  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        读取插件失败：{error.message}
      </p>
    );
  }

  return (
    <>
      {data?.plugins_enabled === false && (
        <p role="alert" className="mb-4 text-sm text-muted-foreground">
          CPA 没有开启插件功能，需要在 config.yaml 的 plugins 里开启后才会加载插件。
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>插件</TableHead>
            <TableHead>版本</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className="w-24">启用</TableHead>
            <TableHead className="w-24">
              <span className="sr-only">操作</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <SkeletonRows columns={5} />
          ) : !data?.plugins?.length ? (
            <EmptyRow columns={5}>还没有插件，可以从插件商店安装。</EmptyRow>
          ) : (
            data.plugins.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <div className="font-medium">{p.metadata?.name || p.id}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.id}
                    {p.metadata?.author && `，作者 ${p.metadata.author}`}
                  </div>
                </TableCell>
                <TableCell className="tabular-nums">{p.metadata?.version || "—"}</TableCell>
                <TableCell>
                  {p.effective_enabled ? (
                    <Badge variant="secondary">运行中</Badge>
                  ) : p.registered ? (
                    <Badge variant="outline">已停用</Badge>
                  ) : (
                    <Badge variant="outline">未加载</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Switch
                    checked={p.enabled === true}
                    disabled={toggle.isPending && toggle.variables?.id === p.id}
                    onCheckedChange={() => toggle.mutate(p)}
                    aria-label={`${p.enabled ? "停用" : "启用"} ${p.metadata?.name || p.id}`}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon-sm" aria-label={`配置 ${p.id}`} onClick={() => setConfiguring(p)}>
                    <Settings2 />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`删除 ${p.id}`}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleting(p)}
                  >
                    <Trash2 />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <ConfigDialog plugin={configuring} onClose={() => setConfiguring(null)} />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除插件</AlertDialogTitle>
            <AlertDialogDescription>会删除 {deleting?.id} 的插件文件和已保存的配置。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => deleting && remove.mutate(deleting)}
            >
              {remove.isPending && <Spinner />}
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Store() {
  const queryClient = useQueryClient();
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["cpa", "plugin-store"],
    queryFn: () => api<StoreResponse>("/v0/management/plugin-store"),
  });

  const install = useMutation({
    mutationFn: (p: StorePlugin) =>
      api<{ restart_required?: boolean; version?: string }>(
        `/v0/management/plugin-store/${encodeURIComponent(p.id)}/install?source=${encodeURIComponent(p.source_id)}`,
        { method: "POST", body: {} },
      ),
    onSuccess: (res, p) => {
      toast.success(`已安装 ${p.name || p.id} ${res.version ?? ""}${res.restart_required ? "，重启 CPA 后生效" : ""}`);
      queryClient.invalidateQueries({ queryKey: ["cpa", "plugin-store"] });
      queryClient.invalidateQueries({ queryKey: PLUGINS_KEY });
    },
  });

  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        读取插件商店失败：{error.message}
      </p>
    );
  }

  const sourceErrors = data?.sources?.filter((s) => s.error) ?? [];

  return (
    <>
      {sourceErrors.map((s) => (
        <p key={s.id} role="alert" className="mb-2 text-sm text-destructive">
          商店源 {s.name || s.id} 读取失败：{s.error}
        </p>
      ))}
      <p className="mb-4 text-sm text-muted-foreground">插件会以可执行文件的形式运行，只安装你信任的来源。</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>插件</TableHead>
            <TableHead>来源</TableHead>
            <TableHead>版本</TableHead>
            <TableHead className="w-28">
              <span className="sr-only">操作</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <SkeletonRows columns={4} />
          ) : !data?.plugins?.length ? (
            <EmptyRow columns={4}>商店里没有插件</EmptyRow>
          ) : (
            data.plugins.map((p) => (
              <TableRow key={p.store_id}>
                <TableCell className="max-w-md">
                  <div className="font-medium">{p.name || p.id}</div>
                  {p.description && <div className="text-sm text-muted-foreground">{p.description}</div>}
                </TableCell>
                <TableCell className="text-muted-foreground">{p.source_name || p.source_id}</TableCell>
                <TableCell className="tabular-nums">
                  {p.installed && p.installed_version && p.installed_version !== p.version
                    ? `${p.installed_version} → ${p.version}`
                    : p.version || "—"}
                </TableCell>
                <TableCell className="text-right">
                  {p.installed && !p.update_available ? (
                    <span className="text-sm text-muted-foreground">已安装</span>
                  ) : (
                    <Button
                      size="sm"
                      variant={p.update_available ? "default" : "outline"}
                      disabled={install.isPending}
                      onClick={() => install.mutate(p)}
                    >
                      {install.isPending && install.variables?.store_id === p.store_id ? <Spinner /> : <Download />}
                      {p.update_available ? "更新" : "安装"}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </>
  );
}

export function PluginsPage() {
  return (
    <>
      <PageHeader title="插件" />
      <Tabs defaultValue="installed">
        <TabsList variant="line" className="mb-6">
          <TabsTrigger value="installed">已安装</TabsTrigger>
          <TabsTrigger value="store">插件商店</TabsTrigger>
        </TabsList>
        <TabsContent value="installed">
          <Installed />
        </TabsContent>
        <TabsContent value="store">
          <Store />
        </TabsContent>
      </Tabs>
    </>
  );
}
