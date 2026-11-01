import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
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
import { Skeleton } from "@/components/ui/skeleton";
import { UnsavedChangesDialog } from "@/components/unsaved-changes-dialog";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { useI18n } from "@/i18n/context";
import { api, CONFIG_KEY, configQuery, errorText } from "@/lib/api";
import { CREDENTIALS_KEY, useCredentials } from "@/lib/credentials";
import {
  applyRoutingPlan,
  assignPriorities,
  boardSignature,
  buildRoutingBoard,
  buildRoutingPlan,
  collectModelOptions,
  draftFromBoard,
  isRoutingConflict,
  moveMember,
  neededChannels,
  neededCredentialModels,
  type RoutingBoard,
  type RoutingDraft,
  type RoutingModelCatalog,
  type RoutingPlan,
  RoutingPriorityError,
  resolveRoute,
  stepMember,
} from "@/lib/routing";
import { cn } from "@/lib/utils";
import { SuggestInput } from "@/pages/models/shared";
import { TierLadder } from "./ladder";
import { PolicyPanel, ReviewDialog, WeightsDialog } from "./panel";

type ModelEntry = { id?: string };
const modelIds = (res: { models?: ModelEntry[] }): string[] =>
  (res.models ?? []).flatMap((model) => (model.id ? [model.id] : []));

type PlanResult = { plan: RoutingPlan; error?: undefined } | { plan?: undefined; error: unknown };

export function RoutingPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const config = useQuery(configQuery);
  const credentials = useCredentials();
  const [model, setModel] = useState("");
  const [weightsKey, setWeightsKey] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reloadOpen, setReloadOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  const board = useMemo<RoutingBoard | null>(
    () =>
      config.data ? buildRoutingBoard(config.data, credentials.files, credentials.dataUpdatedAt || Date.now()) : null,
    [config.data, credentials.files, credentials.dataUpdatedAt],
  );
  const signature = useMemo(() => (board ? boardSignature(board) : ""), [board]);

  // 本地草稿带创建时的配置快照；外部配置变了且本地没有未保存修改时自动跟进
  const [draftState, setDraftState] = useState<{ value: RoutingDraft; signature: string } | null>(null);
  useEffect(() => {
    setDraftState((current) => {
      if (!current || current.signature === signature) return current;
      if (!board) return null;
      try {
        if (buildRoutingPlan(board, current.value).changes.length > 0) return current;
      } catch {
        return current;
      }
      return { value: draftFromBoard(board), signature };
    });
  }, [board, signature]);

  const draft = draftState?.value ?? (board ? draftFromBoard(board) : null);
  const stale = Boolean(draftState && draftState.signature !== signature);

  const planResult = useMemo<PlanResult | null>(() => {
    if (!board || !draft) return null;
    try {
      return { plan: buildRoutingPlan(board, draft) };
    } catch (error) {
      return { error };
    }
  }, [board, draft]);
  const plan = planResult?.plan ?? null;
  const planError = planResult?.error ?? null;
  const dirty = Boolean(plan && plan.changes.length > 0);
  const blocker = useUnsavedChanges(dirty);

  const channels = useMemo(() => (board ? neededChannels(board) : []), [board]);
  const channelQueries = useQueries({
    queries: channels.map((channel) => ({
      queryKey: ["cpa", "model-definitions", channel],
      queryFn: () =>
        api<{ models?: ModelEntry[] }>(`/v8/management/routing/model-definitions/${encodeURIComponent(channel)}`),
      select: modelIds,
      retry: false,
      staleTime: 10 * 60_000,
    })),
  });
  const credentialNames = useMemo(() => (board ? neededCredentialModels(board) : []), [board]);
  const credentialQueries = useQueries({
    queries: credentialNames.map((name) => ({
      queryKey: ["cpa", "credential-models", name],
      queryFn: () =>
        api<{ models?: ModelEntry[] }>(`/v8/management/credentials/models?name=${encodeURIComponent(name)}`),
      select: modelIds,
      retry: false,
      staleTime: 60_000,
    })),
  });

  const catalog = useMemo<RoutingModelCatalog>(() => {
    const channelMap: Record<string, string[] | null> = {};
    channels.forEach((channel, index) => {
      channelMap[channel] = channelQueries[index]?.data ?? null;
    });
    const credentialMap: Record<string, string[] | null> = {};
    credentialNames.forEach((name, index) => {
      credentialMap[name] = credentialQueries[index]?.data ?? null;
    });
    return { channels: channelMap, credentials: credentialMap };
  }, [channels, channelQueries, credentialNames, credentialQueries]);

  const modelOptions = useMemo(() => (board ? collectModelOptions(board, catalog) : []), [board, catalog]);
  const requestedModel = model.trim() || null;
  const preview = useMemo(
    () => (board && draft ? resolveRoute(board, draft, catalog, requestedModel, nowMs) : null),
    [board, draft, catalog, requestedModel, nowMs],
  );

  const save = useMutation({
    mutationFn: ({ board: current, plan: pending }: { board: RoutingBoard; plan: RoutingPlan }) =>
      applyRoutingPlan(current, pending),
    onSuccess: async (result) => {
      setReviewOpen(false);
      if (!result.failed) {
        toast.success(t("routing.saved"));
      } else if (isRoutingConflict(result.failed.error)) {
        toast.error(t("routing.conflict"));
      } else {
        toast.error(t("routing.save_failed", { message: errorText(result.failed.error) }));
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CONFIG_KEY }),
        queryClient.invalidateQueries({ queryKey: CREDENTIALS_KEY }),
      ]);
    },
    onError: (error) => {
      setReviewOpen(false);
      toast.error(errorText(error));
    },
    meta: { quiet: true },
  });

  const refetch = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: CONFIG_KEY }),
      queryClient.invalidateQueries({ queryKey: CREDENTIALS_KEY }),
    ]);
  };

  const resetDraft = () => {
    if (!board) return;
    setDraftState({ value: draftFromBoard(board), signature });
  };

  const requestReload = () => {
    if (dirty) {
      setReloadOpen(true);
      return;
    }
    void refetch();
  };

  const confirmReload = async () => {
    setReloadOpen(false);
    setDraftState(null);
    await refetch();
  };

  const updateDraft = (next: RoutingDraft) => {
    setDraftState({ value: next, signature: draftState?.signature ?? signature });
  };

  const weightsMember =
    board && weightsKey ? (board.members.find((member) => member.key === weightsKey) ?? null) : null;

  const header = (
    <PageHeader
      title={t("routing.title")}
      description={t("routing.desc")}
      actions={
        <>
          {board && (
            <Badge variant="secondary" className="tabular-nums">
              {t("routing.member_count", { count: board.members.length })}
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={requestReload}
            disabled={config.isFetching || credentials.isFetching}
          >
            <RefreshCw className={cn(config.isFetching || credentials.isFetching ? "animate-spin" : undefined)} />
            {t("common.refresh")}
          </Button>
        </>
      }
    />
  );

  if (config.isPending || credentials.isPending) {
    return (
      <>
        {header}
        <Skeleton className="h-72 w-full" />
      </>
    );
  }

  const loadError = config.error ?? credentials.error;
  if (loadError || !board || !draft) {
    return (
      <>
        {header}
        <p role="alert" className="text-sm text-destructive">
          {t("routing.load_failed", { message: errorText(loadError) })}
        </p>
      </>
    );
  }

  // 梯队标题显示的是这次排列对应的完整优先级，不只是有变化的那些
  let levels: Record<string, number> = {};
  try {
    levels = assignPriorities(draft.tiers, board.members);
  } catch {
    levels = {};
  }

  const activeTier = preview?.tiers.findIndex((tier) => tier.state === "active") ?? -1;
  const activeMembers =
    activeTier >= 0
      ? (preview?.tiers[activeTier]?.members
          .filter((member) => member.state === "serving")
          .map((member) => board.members.find((item) => item.key === member.key)?.name ?? member.key) ?? [])
      : [];
  const previewText = !preview
    ? ""
    : activeTier >= 0
      ? t("routing.preview_hits", { tier: activeTier + 1, members: activeMembers.join(", ") })
      : requestedModel
        ? t("routing.preview_miss_model", { model: requestedModel })
        : t("routing.preview_miss");

  return (
    <>
      {header}

      <div className="mb-4 flex flex-col gap-2.5 rounded-lg border bg-muted/20 p-3 xl:flex-row xl:items-center">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <GitBranch className="size-3.5 text-muted-foreground" />
          {t("routing.preview_label")}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 xl:w-80">
          <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <SuggestInput
            id="routing-model"
            value={model}
            onChange={setModel}
            options={modelOptions}
            placeholder={t("routing.model_placeholder")}
            ariaLabel={t("routing.model_placeholder")}
          />
          {model && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("routing.clear_model")}
              title={t("routing.clear_model")}
              onClick={() => setModel("")}
            >
              <X />
            </Button>
          )}
        </div>
        <p className={cn("min-w-0 text-xs text-muted-foreground xl:ml-auto", !preview?.hasActive && "text-warning")}>
          {previewText}
        </p>
      </div>

      {stale && dirty && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <span className="min-w-0 flex-1">{t("routing.stale_notice")}</span>
          <Button variant="outline" size="xs" onClick={requestReload}>
            {t("routing.reload")}
          </Button>
        </div>
      )}

      {planError && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {planError instanceof RoutingPriorityError ? t("routing.priority_error") : errorText(planError)}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0">
          <TierLadder
            board={board}
            draft={draft}
            priorities={levels}
            preview={preview ?? { tiers: [], hasActive: false }}
            strategy={draft.settings.strategy}
            model={requestedModel}
            nowMs={nowMs}
            disabled={save.isPending}
            onMove={(key, target) => updateDraft({ ...draft, tiers: moveMember(draft.tiers, key, target) })}
            onStep={(key, direction) => updateDraft({ ...draft, tiers: stepMember(draft.tiers, key, direction) })}
            onEditWeights={(key) => setWeightsKey(key)}
          />
        </div>
        <PolicyPanel
          settings={draft.settings}
          disabled={save.isPending}
          onChange={(settings) => updateDraft({ ...draft, settings })}
        />
      </div>

      {dirty && plan && (
        <div className="sticky bottom-4 z-20 mt-4 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur">
          <span className="text-xs font-medium">{t("routing.unsaved", { count: plan.changes.length })}</span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={resetDraft} disabled={save.isPending}>
              {t("routing.discard")}
            </Button>
            <Button size="sm" onClick={() => setReviewOpen(true)} disabled={save.isPending || Boolean(planError)}>
              {t("routing.review")}
            </Button>
          </div>
        </div>
      )}

      {weightsMember && (
        <WeightsDialog
          member={weightsMember}
          initial={draft.weights[weightsMember.key] ?? []}
          onClose={() => setWeightsKey(null)}
          onSave={(weights) => {
            updateDraft({ ...draft, weights: { ...draft.weights, [weightsMember.key]: weights } });
            setWeightsKey(null);
          }}
        />
      )}

      {reviewOpen && plan && (
        <ReviewDialog
          board={board}
          plan={plan}
          pending={save.isPending}
          onClose={() => setReviewOpen(false)}
          onConfirm={() => save.mutate({ board, plan })}
        />
      )}

      <AlertDialog open={reloadOpen} onOpenChange={setReloadOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("routing.reload_title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("routing.reload_desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.keep_editing")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmReload()}>
              {t("routing.reload")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <UnsavedChangesDialog blocker={blocker} />
    </>
  );
}
