import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Pagination, paginate } from "@/components/pagination";
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
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n/context";
import { api, errorText } from "@/lib/api";
import {
  formatRepoUrl,
  GithubIcon,
  PluginLogo,
  refreshPlugins,
  STORE_KEY,
  type StorePlugin,
  type StoreResponse,
} from "./shared";

export function Store() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [installingTarget, setInstallingTarget] = useState<StorePlugin | null>(null);
  const [customVersion, setCustomVersion] = useState("");
  const [page, setPage] = useState(1);

  const { data, isPending, isError, error } = useQuery({
    queryKey: STORE_KEY,
    queryFn: () => api<StoreResponse>("/v8/management/plugins/store"),
    // 每次拉取服务端都会请求 GitHub,容易触发限流
    staleTime: 600_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const install = useMutation({
    mutationFn: ({ plugin: p, version }: { plugin: StorePlugin; version?: string }) => {
      const body = version?.trim() ? { version: version.trim() } : {};
      return api<{ version?: string }>(
        `/v8/management/plugins/store/${encodeURIComponent(p.id)}/install?source=${encodeURIComponent(p.source_id)}`,
        { method: "POST", body },
      );
    },
    meta: { quiet: true },
    onSuccess: (res, { plugin: p }) => {
      toast.success(t("plugins.installed_toast", { name: p.name || p.id, version: res.version ?? "" }));
      queryClient.invalidateQueries({ queryKey: STORE_KEY });
      refreshPlugins(queryClient, (plugins) => plugins.some((x) => x.id === p.id));
      setInstallingTarget(null);
      setCustomVersion("");
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const sourceName = (id?: string) => data?.sources?.find((s) => s.id === id)?.name || id;
  const plugins = useMemo(() => {
    const list = data?.plugins ?? [];
    if (!search.trim()) return list;
    const term = search.toLowerCase().trim();
    return list.filter(
      (p) =>
        p.name?.toLowerCase().includes(term) ||
        p.id.toLowerCase().includes(term) ||
        p.description?.toLowerCase().includes(term) ||
        p.author?.toLowerCase().includes(term),
    );
  }, [data?.plugins, search]);

  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("plugins.store_load_failed", { message: errorText(error) })}
      </p>
    );
  }

  return (
    <>
      {data?.source_errors?.map((s) => (
        <p key={s.source_id} role="alert" className="mb-2 text-sm text-destructive">
          {t("plugins.source_load_failed", { name: s.source_name || s.source_url || s.source_id, error: s.message })}
        </p>
      ))}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("plugins.store_hint")}</p>
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder={t("plugins.search_placeholder")}
          className="w-56 sm:w-80 text-xs"
        />
      </div>
      {isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-44 rounded-lg" />
          ))}
        </div>
      ) : plugins.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          {search.trim() ? t("plugins.store_no_match") : t("plugins.store_empty")}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {paginate(plugins, page, 9).pageItems.map((p) => {
              const repoUrl = formatRepoUrl(p.repository, p.homepage);
              const isOfficial = (p.repository || "").toLowerCase().includes("router-for-me/");
              const platformList = (p.platforms ?? [])
                .map((plat) => (plat.goos && plat.goarch ? `${plat.goos}/${plat.goarch}` : ""))
                .filter(Boolean);

              return (
                <Card
                  key={p.store_id}
                  className="flex flex-col justify-between transition-colors hover:border-foreground/20"
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start gap-3">
                      <PluginLogo src={p.logo} name={p.name || p.id} size="md" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <CardTitle className="truncate text-base font-semibold" title={p.name || p.id}>
                            {p.name || p.id}
                          </CardTitle>
                          {p.installed && !p.update_available && (
                            <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4">
                              {t("plugins.badge_installed")}
                            </Badge>
                          )}
                          {p.update_available && (
                            <Badge variant="default" className="text-xs px-1.5 py-0 h-4">
                              {t("plugins.badge_update_available")}
                            </Badge>
                          )}
                          {!isOfficial && p.repository && (
                            <Badge variant="outline" className="text-xs px-1.5 py-0 h-4 text-warning border-warning/40">
                              {t("plugins.badge_third_party")}
                            </Badge>
                          )}
                          {p.auth_required && (
                            <Badge variant="outline" className="text-xs px-1.5 py-0 h-4 text-muted-foreground">
                              {p.auth_configured
                                ? t("plugins.badge_auth_configured")
                                : t("plugins.badge_auth_required")}
                            </Badge>
                          )}
                        </div>
                        <div
                          className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground truncate"
                          title={p.id}
                        >
                          <span className="font-mono text-xs">{p.id}</span>
                          {p.author && (
                            <>
                              <span>·</span>
                              <span className="truncate">by {p.author}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-0.5 shrink-0">
                        {repoUrl && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground hover:text-foreground"
                            title={t("plugins.view_repo")}
                            aria-label={t("plugins.view_repo")}
                            render={
                              <a href={repoUrl} target="_blank" rel="noreferrer">
                                <GithubIcon className="size-3.5" />
                              </a>
                            }
                          />
                        )}
                        {p.homepage && !p.homepage.includes("github.com") && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground hover:text-foreground"
                            title={t("plugins.view_homepage")}
                            aria-label={t("plugins.view_homepage")}
                            render={
                              <a href={p.homepage} target="_blank" rel="noreferrer">
                                <ExternalLink className="size-3.5" />
                              </a>
                            }
                          />
                        )}
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="flex-1 space-y-2.5 pb-3 text-sm text-muted-foreground">
                    <p className="line-clamp-3 leading-relaxed whitespace-pre-wrap wrap-break-word text-xs sm:text-sm">
                      {p.description || t("plugins.no_description")}
                    </p>

                    {/* 标签列表 */}
                    {p.tags && p.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {p.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* 规格明细：许可证、安装类型、系统平台 */}
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground/80 pt-1">
                      {p.license && (
                        <span>{t("plugins.label_value", { label: t("plugins.license"), value: p.license })}</span>
                      )}
                      {p.install_type && (
                        <span>
                          {t("plugins.label_value", {
                            label: t("plugins.install_type"),
                            value: p.install_type.replace(/-/g, " "),
                          })}
                        </span>
                      )}
                      {platformList.length > 0 && (
                        <span title={platformList.join(", ")}>
                          {t("plugins.label_value", {
                            label: t("plugins.platforms"),
                            value: platformList.slice(0, 2).join(", "),
                          })}
                          {platformList.length > 2 && ` +${platformList.length - 2}`}
                        </span>
                      )}
                    </div>
                  </CardContent>

                  <CardFooter className="flex items-center justify-between border-t bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground">
                    <div className="flex flex-col gap-0.5">
                      <span className="truncate max-w-30" title={p.source_name || p.source_id}>
                        {p.source_name || p.source_id}
                      </span>
                      <span className="font-mono text-xs">
                        {p.installed && p.installed_version && p.installed_version !== p.version
                          ? `${p.installed_version} → ${p.version}`
                          : `v${p.version || "0.0.0"}`}
                      </span>
                    </div>

                    <div>
                      {p.installed && !p.update_available ? (
                        <Button size="sm" variant="ghost" disabled className="h-8 text-xs text-muted-foreground">
                          {t("plugins.badge_installed")}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant={p.update_available ? "default" : "outline"}
                          disabled={install.isPending}
                          onClick={() => {
                            setInstallingTarget(p);
                            setCustomVersion(p.version || "");
                          }}
                        >
                          {install.isPending && install.variables?.plugin.store_id === p.store_id ? (
                            <Spinner className="size-3.5" />
                          ) : (
                            <Download className="size-3.5" />
                          )}
                          {p.update_available ? t("plugins.update") : t("plugins.install")}
                        </Button>
                      )}
                    </div>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
          <Pagination
            page={paginate(plugins, page, 9).current}
            pageCount={paginate(plugins, page, 9).pageCount}
            total={plugins.length}
            onChange={(nextPage) => {
              setPage(nextPage);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        </>
      )}

      <AlertDialog open={installingTarget !== null} onOpenChange={(open) => !open && setInstallingTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="size-5 shrink-0" />
              <AlertDialogTitle>{t("plugins.install_confirm_title")}</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="space-y-3 pt-2 text-sm leading-relaxed">
              <p>
                {t("plugins.install_confirm_target", {
                  name: installingTarget?.name || installingTarget?.id,
                  version: installingTarget?.version || t("plugins.version_unknown"),
                  source: installingTarget?.source_name || installingTarget?.source_id,
                })}
              </p>
              {(installingTarget?.install_source_status === "different" ||
                installingTarget?.install_source_status === "unknown") && (
                <p role="alert" className="text-warning">
                  {installingTarget.install_source_status === "different"
                    ? t("plugins.warn_source_different", { source: sourceName(installingTarget.installed_source_id) })
                    : t("plugins.warn_source_unknown")}
                </p>
              )}
              <div className="grid gap-1.5 pt-1">
                <Label htmlFor="plugin-version-input" className="text-xs text-muted-foreground">
                  {t("plugins.install_version_label")}
                </Label>
                <Input
                  id="plugin-version-input"
                  value={customVersion}
                  onChange={(e) => setCustomVersion(e.target.value)}
                  placeholder={t("plugins.install_version_placeholder")}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-foreground/90 space-y-1.5">
                <p className="font-semibold text-destructive">{t("plugins.security_risk_title")}</p>
                <p className="text-muted-foreground">{t("plugins.security_risk_desc")}</p>
              </div>
              <p className="text-xs text-muted-foreground font-medium">{t("plugins.install_confirm_question")}</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={install.isPending}
              onClick={() => {
                if (installingTarget) {
                  install.mutate({ plugin: installingTarget, version: customVersion });
                }
              }}
            >
              {install.isPending && <Spinner />}
              {t("plugins.trust_and_install")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
