import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Globe, Settings2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/i18n/context";
import { ApiError, api, configPath, errorText } from "@/lib/api";
import { PLUGINS_KEY, type Plugin, type PluginsResponse, resolvePluginMenuUrl } from "@/lib/plugins";
import { ConfigDialog, PluginViewerDialog } from "./plugin-config";
import { GithubIcon, PluginLogo, refreshPlugins } from "./shared";

export function Installed() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [configuring, setConfiguring] = useState<Plugin | null>(null);
  const [deleting, setDeleting] = useState<Plugin | null>(null);
  const [viewingResource, setViewingResource] = useState<{ title: string; subtitle?: string; url: string } | null>(
    null,
  );
  const { data, isPending, isError, error } = useQuery({
    queryKey: PLUGINS_KEY,
    queryFn: () => api<PluginsResponse>("/v8/management/plugins"),
  });

  const toggle = useMutation({
    mutationFn: (p: Plugin) =>
      api(configPath("plugins", "configs", p.id, "enabled"), { method: "PUT", body: !p.enabled }),
    onSuccess: (_res, p) =>
      refreshPlugins(queryClient, (plugins) => plugins.find((x) => x.id === p.id)?.effective_enabled === !p.enabled),
  });

  const remove = useMutation({
    mutationFn: (p: Plugin) => api(`/v8/management/plugins/${encodeURIComponent(p.id)}`, { method: "DELETE" }),
    meta: { quiet: true },
    onSuccess: (_res, p) => {
      toast.success(t("plugins.deleted", { id: p.id }));
      setDeleting(null);
      refreshPlugins(queryClient, (plugins) => !plugins.some((x) => x.id === p.id));
    },
    onError: (e) => {
      toast.error(errorText(e));
      // 插件已加载删不掉,重试没用,关掉对话框
      if (e instanceof ApiError && e.code === "plugin_delete_requires_restart") setDeleting(null);
    },
  });

  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("plugins.load_failed", { message: errorText(error) })}
      </p>
    );
  }

  return (
    <>
      {data?.plugins_enabled === false && (
        <p role="alert" className="mb-4 text-sm text-muted-foreground">
          {t("plugins.plugins_disabled")}
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("plugins.th_plugin")}</TableHead>
            <TableHead>{t("plugins.th_version")}</TableHead>
            <TableHead>{t("plugins.th_status")}</TableHead>
            <TableHead className="w-24">{t("plugins.th_switch")}</TableHead>
            <TableHead className="w-24">
              <span className="sr-only">{t("plugins.th_actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <SkeletonRows columns={5} />
          ) : !data?.plugins?.length ? (
            <EmptyRow columns={5}>{t("plugins.empty_installed")}</EmptyRow>
          ) : (
            data.plugins.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <PluginLogo src={p.logo || p.metadata?.logo} name={p.metadata?.name || p.id} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-medium truncate">{p.metadata?.name || p.id}</div>
                        {p.supports_oauth && (
                          <Badge variant="outline" className="text-xs font-normal">
                            OAuth
                          </Badge>
                        )}
                        {p.metadata?.github_repository && (
                          <a
                            href={
                              p.metadata.github_repository.startsWith("http")
                                ? p.metadata.github_repository
                                : `https://github.com/${p.metadata.github_repository}`
                            }
                            target="_blank"
                            rel="noreferrer"
                            title={t("plugins.view_repo")}
                            aria-label={t("plugins.view_repo")}
                            className="inline-flex text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <GithubIcon className="size-3.5" />
                          </a>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {p.id}
                        {p.metadata?.author && ` · by ${p.metadata.author}`}
                      </div>
                    </div>
                  </div>
                  {p.effective_enabled && (p.menus?.length ?? 0) > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {p.menus?.map((m) => {
                        const href = resolvePluginMenuUrl(p.id, m.path);
                        const label = m.menu || m.path;
                        return (
                          <div
                            key={m.path}
                            className="inline-flex items-center rounded-md border bg-muted/40 text-xs shadow-2xs hover:bg-muted"
                          >
                            <button
                              type="button"
                              className="flex items-center gap-1.5 px-2.5 py-1 text-left font-medium hover:text-primary cursor-pointer"
                              title={m.description || label}
                              onClick={() =>
                                setViewingResource({
                                  title: `${p.metadata?.name || p.id} - ${label}`,
                                  subtitle: m.description,
                                  url: href,
                                })
                              }
                            >
                              <Globe className="size-3 text-muted-foreground" />
                              <span>{label}</span>
                            </button>
                            <a
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              title={t("plugins.open_in_new_tab")}
                              aria-label={t("plugins.open_named_in_new_tab", { name: label })}
                              className="border-l p-1.5 text-muted-foreground hover:text-foreground"
                            >
                              <ExternalLink className="size-3" />
                            </a>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </TableCell>
                <TableCell className="tabular-nums">{p.metadata?.version || "—"}</TableCell>
                <TableCell>
                  {p.effective_enabled ? (
                    <Badge variant="secondary">{t("plugins.status_running")}</Badge>
                  ) : p.registered ? (
                    <Badge variant="outline">{t("plugins.status_disabled")}</Badge>
                  ) : (
                    <Badge variant="outline">{t("plugins.status_unloaded")}</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Switch
                    checked={p.enabled === true}
                    disabled={toggle.isPending && toggle.variables?.id === p.id}
                    onCheckedChange={() => toggle.mutate(p)}
                    aria-label={t(p.enabled ? "plugins.disable_named" : "plugins.enable_named", {
                      name: p.metadata?.name || p.id,
                    })}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("plugins.configure_named", { name: p.id })}
                    onClick={() => setConfiguring(p)}
                  >
                    <Settings2 />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("plugins.delete_named", { name: p.id })}
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

      {configuring && <ConfigDialog plugin={configuring} onClose={() => setConfiguring(null)} />}
      {viewingResource && (
        <PluginViewerDialog
          title={viewingResource.title}
          subtitle={viewingResource.subtitle}
          url={viewingResource.url}
          onClose={() => setViewingResource(null)}
        />
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("plugins.delete_title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("plugins.delete_desc", { id: deleting?.id })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => deleting && remove.mutate(deleting)}
            >
              {remove.isPending && <Spinner />}
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
