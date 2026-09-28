import { SiGithub } from "@icons-pack/react-simple-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpCircle, CheckCircle2, Download, ExternalLink, Info, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { Trans } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import i18n from "@/i18n";
import { useI18n } from "@/i18n/context";
import { request } from "@/lib/api";

declare const __APP_VERSION__: string | undefined;
const FRONTEND_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "";
const GITHUB_REPO = "tom2almighty/cpa-dashboard";

function newer(latest: string, current: string): boolean {
  if (!latest || !current) return false;
  const parse = (v: string) => v.replace(/^v/, "").split(/[.-]/).map(Number);
  const [a, b] = [parse(latest), parse(current)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

type GitHubRelease = {
  tag_name: string;
  name?: string;
  body?: string;
  html_url: string;
  published_at?: string;
  assets?: { name: string; browser_download_url: string; size: number }[];
};

export function useVersionData() {
  const cpaQuery = useQuery({
    queryKey: ["cpa", "version"],
    queryFn: async () => {
      const res = await request("/v8/management/server/latest-version");
      const body = res.ok ? ((await res.json().catch(() => ({}))) as { "latest-version"?: string }) : {};
      return {
        current: res.headers.get("x-cpa-version") || "",
        latest: body["latest-version"] ?? null,
      };
    },
    staleTime: 600_000,
    refetchOnWindowFocus: false,
  });

  const panelReleaseQuery = useQuery({
    queryKey: ["panel", "latest-release"],
    queryFn: async () => {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers: { "User-Agent": "cpa-dashboard" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(i18n.t("version.release_query_failed", { status: res.status }));
      return (await res.json()) as GitHubRelease;
    },
    staleTime: 600_000,
    refetchOnWindowFocus: false,
  });

  const cpaCurrent = cpaQuery.data?.current || i18n.t("version.unknown");
  const cpaLatest = cpaQuery.data?.latest;
  const cpaHasUpdate = Boolean(cpaLatest && newer(cpaLatest, cpaCurrent));

  const panelLatest = panelReleaseQuery.data?.tag_name;
  const currentVersion = FRONTEND_VERSION || panelLatest || "";
  const panelHasUpdate = Boolean(panelLatest && currentVersion && newer(panelLatest, currentVersion));

  const hasAnyUpdate = cpaHasUpdate || panelHasUpdate;

  return {
    cpaQuery,
    panelReleaseQuery,
    cpaCurrent,
    cpaLatest,
    cpaHasUpdate,
    panelLatest,
    panelHasUpdate,
    currentVersion,
    hasAnyUpdate,
  };
}

function VersionCardContent() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [checking, setChecking] = useState(false);
  const { panelReleaseQuery, cpaCurrent, cpaLatest, cpaHasUpdate, panelLatest, panelHasUpdate, currentVersion } =
    useVersionData();
  const handleCheckUpdates = async () => {
    setChecking(true);
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: ["cpa", "version"] }),
      queryClient.invalidateQueries({ queryKey: ["panel", "latest-release"] }),
    ]);
    setChecking(false);
    toast.success(t("version.checked_success"));
  };

  const managementAsset = panelReleaseQuery.data?.assets?.find((a) => a.name === "management.html");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <p className="text-xs text-muted-foreground">{t("version.desc")}</p>
        <Button variant="outline" size="sm" onClick={handleCheckUpdates} disabled={checking}>
          {checking ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />}
          {checking ? t("version.checking") : t("version.check_now")}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* 前端面板版本 */}
        <Card className="flex flex-col justify-between">
          <CardHeader className="pb-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Sparkles className="size-4 text-primary" />
                <CardTitle className="text-sm font-medium">{t("version.panel_version")}</CardTitle>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-6 text-muted-foreground hover:text-foreground"
                  title="GitHub"
                  aria-label="GitHub Repository"
                  render={<a href={`https://github.com/${GITHUB_REPO}`} target="_blank" rel="noreferrer" />}
                >
                  <SiGithub className="size-3.5" />
                </Button>
              </div>
              {panelHasUpdate ? (
                <Badge variant="default" className="text-[10px] h-5 gap-1">
                  <ArrowUpCircle className="size-3" />
                  {t("version.update_available")}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] h-5 text-muted-foreground gap-1">
                  <CheckCircle2 className="size-3 text-muted-foreground" />
                  {t("version.up_to_date")}
                </Badge>
              )}
            </div>
            <CardDescription className="text-xs">{t("version.standalone")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t("version.running_version")}</span>
              <span className="font-mono font-medium">{currentVersion || t("common.none")}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t("version.latest_release")}</span>
              <span className="font-mono font-medium">{panelLatest || t("version.checking")}</span>
            </div>

            {panelHasUpdate && (
              <div className="mt-3 rounded-lg border border-border bg-muted/40 p-2.5 space-y-2">
                <p className="font-medium text-foreground">
                  {t("version.found_new_version")} {panelLatest}！
                </p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  <Trans
                    i18nKey="version.auto_update_hint"
                    components={{ code: <code className="text-foreground font-mono" /> }}
                  />
                </p>
                <div className="flex flex-wrap gap-2 pt-0.5">
                  <Button
                    size="xs"
                    nativeButton={false}
                    render={<a href={panelReleaseQuery.data?.html_url} target="_blank" rel="noreferrer" />}
                  >
                    <ExternalLink className="size-3" />
                    {t("version.view_changelog")}
                  </Button>
                  {managementAsset && (
                    <Button
                      variant="outline"
                      size="xs"
                      nativeButton={false}
                      render={<a href={managementAsset.browser_download_url} download="management.html" />}
                    >
                      <Download className="size-3" />
                      {t("version.download_manual")}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 后端 CPA 版本 */}
        <Card className="flex flex-col justify-between">
          <CardHeader className="pb-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Info className="size-4 text-primary" />
                <CardTitle className="text-sm font-medium">{t("version.cpa_version")}</CardTitle>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-6 text-muted-foreground hover:text-foreground"
                  title="GitHub"
                  aria-label="GitHub Repository"
                  render={<a href="https://github.com/router-for-me/CLIProxyAPI" target="_blank" rel="noreferrer" />}
                >
                  <SiGithub className="size-3.5" />
                </Button>
              </div>
              {cpaHasUpdate ? (
                <Badge variant="default" className="text-[10px] h-5 gap-1">
                  <ArrowUpCircle className="size-3" />
                  {t("version.update_available")}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] h-5 text-muted-foreground gap-1">
                  <CheckCircle2 className="size-3 text-muted-foreground" />
                  {t("version.up_to_date")}
                </Badge>
              )}
            </div>
            <CardDescription className="text-xs">{t("version.cpa_desc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t("version.running_version")}</span>
              <span className="font-mono font-medium">{cpaCurrent}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t("version.latest_release")}</span>
              <span className="font-mono font-medium">{cpaLatest || t("version.checking")}</span>
            </div>

            {cpaHasUpdate && (
              <div className="mt-3 rounded-lg border border-border bg-muted/40 p-2.5 space-y-2">
                <p className="font-medium text-foreground">{t("version.cpa_upgrade_to", { version: cpaLatest })}</p>
                <Button
                  variant="outline"
                  size="xs"
                  render={
                    <a
                      href="https://github.com/router-for-me/CLIProxyAPI/releases/latest"
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  <ExternalLink className="size-3" />
                  {t("version.cpa_release")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function VersionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <DialogTitle>{t("version.dialog_title")}</DialogTitle>
          </div>
          <DialogDescription className="text-xs">{t("version.dialog_desc")}</DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <VersionCardContent />
        </div>
      </DialogContent>
    </Dialog>
  );
}
