import {
  ArrowDown,
  ArrowUp,
  Ellipsis,
  FileKey,
  GripVertical,
  KeyRound,
  Lock,
  Network,
  SlidersHorizontal,
} from "lucide-react";
import { type DragEvent, Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n/context";
import {
  activeCooldownSeconds,
  canStepMember,
  type RouteMemberState,
  type RoutePreview,
  type RouteTierState,
  type RoutingBoard,
  type RoutingDraft,
  type RoutingDropTarget,
  type RoutingMember,
  type RoutingStrategy,
  tierIndexOf,
} from "@/lib/routing";
import { cn } from "@/lib/utils";

const MEMBER_STATE_CLASS: Record<RouteMemberState, string> = {
  serving: "border-success/40 bg-success/10 text-success",
  cooling: "border-warning/40 bg-warning/10 text-warning",
  blocked: "border-destructive/40 bg-destructive/10 text-destructive",
  disabled: "border-destructive/30 bg-destructive/5 text-destructive",
  excluded: "border-border bg-muted/40 text-muted-foreground",
  ineligible: "border-border bg-muted/20 text-muted-foreground",
  unknown: "border-border text-muted-foreground",
};

const TIER_STATE_CLASS: Record<RouteTierState, string> = {
  active: "bg-primary/5 ring-primary/40",
  standby: "bg-card ring-foreground/10",
  cooling: "bg-warning/5 ring-warning/40",
  unknown: "bg-card ring-foreground/10",
  skipped: "bg-muted/30 ring-foreground/10",
};

const MEMBER_STATE_TEXT: Record<RouteMemberState, string> = {
  serving: "text-success",
  cooling: "text-warning",
  blocked: "text-destructive",
  disabled: "text-destructive",
  excluded: "text-muted-foreground",
  ineligible: "text-muted-foreground",
  unknown: "text-muted-foreground",
};

const TIER_BADGE_CLASS: Record<RouteTierState, string> = {
  active: "border-success/40 bg-success/10 text-success",
  standby: "text-muted-foreground",
  cooling: "border-warning/40 bg-warning/10 text-warning",
  unknown: "text-muted-foreground",
  skipped: "text-muted-foreground",
};

const kindIcon = (kind: RoutingMember["kind"]) =>
  kind === "credential" ? FileKey : kind === "compat" ? Network : KeyRound;

const sameTarget = (left: RoutingDropTarget | null, right: RoutingDropTarget): boolean => {
  if (!left) return false;
  return left.kind === right.kind
    ? left.kind === "tier"
      ? left.tierId === (right as { tierId: string }).tierId
      : left.index === (right as { index: number }).index
    : false;
};

const familyLabel = (family: string): string =>
  family === "openai-compatibility"
    ? "OpenAI Compatible"
    : family.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

function formatSeconds(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}

function MemberRow({
  member,
  state,
  share,
  cooldown,
  strategy,
  weights,
  canUp,
  canDown,
  dragging,
  disabled,
  onDragStart,
  onDragEnd,
  onStep,
  onEditWeights,
}: {
  member: RoutingMember;
  state: RouteMemberState | undefined;
  share: number | null;
  cooldown: number;
  strategy: RoutingStrategy;
  weights: readonly (number | null)[];
  canUp: boolean;
  canDown: boolean;
  dragging: boolean;
  disabled: boolean;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onStep: (direction: "up" | "down") => void;
  onEditWeights: () => void;
}) {
  const { t } = useI18n();
  // 没有 Key 的兼容提供商仍会调度一次，但没有可编辑的权重
  const hasWeights = member.weights.length > 0;
  const weightSum = weights.reduce<number>((sum, value) => sum + Math.max(0, value ?? 1), 0);
  const stateLabel =
    state === "cooling" && cooldown > 0 ? t("routing.state_cooling_for", { time: formatSeconds(cooldown) }) : null;
  const KindIcon = kindIcon(member.kind);

  return (
    <li
      draggable={!disabled && !member.locked}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group flex items-center gap-2.5 px-3.5 py-2.5 transition-colors",
        dragging ? "opacity-40" : "hover:bg-muted/30",
        state === "disabled" && "opacity-60",
      )}
    >
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground",
          member.locked ? "cursor-not-allowed opacity-40" : "cursor-grab active:cursor-grabbing",
        )}
        title={member.locked ? t("routing.locked_hint") : t("routing.drag_hint")}
        aria-hidden
      >
        {member.locked ? <Lock className="size-3.5" /> : <GripVertical className="size-3.5" />}
      </span>

      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground"
        aria-hidden
      >
        <KindIcon className="size-3.5" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium" title={member.name}>
            {member.name}
          </span>
          <Badge variant="outline" className="hidden shrink-0 text-[10px] font-normal sm:inline-flex">
            {familyLabel(member.family)}
          </Badge>
          {member.locked && (
            <Badge variant="secondary" className="hidden shrink-0 text-[10px] font-normal sm:inline-flex">
              {t("routing.runtime_only")}
            </Badge>
          )}
        </div>
        {(member.detail || (state && state !== "serving")) && (
          <div className="flex min-w-0 items-center gap-1.5">
            {state && state !== "serving" && (
              <span className={cn("shrink-0 text-[10px] font-medium sm:hidden", MEMBER_STATE_TEXT[state])}>
                {stateLabel ?? t(`routing.state_${state}` as never)}
              </span>
            )}
            {member.detail && (
              <p className="truncate font-mono text-[11px] text-muted-foreground" title={member.detail}>
                {member.detail}
              </p>
            )}
          </div>
        )}
      </div>

      {state && (
        <Badge
          variant="outline"
          className={cn("hidden shrink-0 text-[10px] font-normal sm:inline-flex", MEMBER_STATE_CLASS[state])}
        >
          {stateLabel ?? t(`routing.state_${state}` as never)}
        </Badge>
      )}

      {strategy !== "fill-first" && share !== null && state === "serving" && (
        <span className="hidden shrink-0 rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground sm:inline-flex">
          {share}%
        </span>
      )}

      {hasWeights && (
        <Button
          variant="ghost"
          size="xs"
          className="shrink-0 gap-1.5 px-2 font-mono text-[10px] text-muted-foreground"
          aria-label={t("routing.edit_weights_for", { name: member.name })}
          title={t("routing.edit_weights")}
          disabled={disabled}
          onClick={onEditWeights}
        >
          <SlidersHorizontal className="size-3.5" />
          <span className="tabular-nums">
            {member.weights.length > 1
              ? t("routing.weight_slots", { count: member.weights.length, sum: weightSum })
              : t("routing.weight_value", { value: weightSum })}
          </span>
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 text-muted-foreground"
              aria-label={t("routing.member_actions", { name: member.name })}
            />
          }
        >
          <Ellipsis />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem disabled={!canUp || disabled} onClick={() => onStep("up")}>
            <ArrowUp />
            {t("routing.move_up")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canDown || disabled} onClick={() => onStep("down")}>
            <ArrowDown />
            {t("routing.move_down")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={disabled || !hasWeights} onClick={onEditWeights}>
            <SlidersHorizontal />
            {t("routing.edit_weights")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

export function TierLadder({
  board,
  draft,
  priorities,
  preview,
  strategy,
  model,
  nowMs,
  disabled,
  onMove,
  onStep,
  onEditWeights,
}: {
  board: RoutingBoard;
  draft: RoutingDraft;
  priorities: Record<string, number>;
  preview: RoutePreview;
  strategy: RoutingStrategy;
  model: string | null;
  nowMs: number;
  disabled: boolean;
  onMove: (key: string, target: RoutingDropTarget) => void;
  onStep: (key: string, direction: "up" | "down") => void;
  onEditWeights: (key: string) => void;
}) {
  const { t } = useI18n();
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [hover, setHover] = useState<RoutingDropTarget | null>(null);
  const members = new Map(board.members.map((member) => [member.key, member]));
  const routes = new Map(preview.tiers.map((tier) => [tier.tierId, tier]));
  const tiers = draft.tiers;

  const isValidTarget = (target: RoutingDropTarget): boolean => {
    if (!dragKey) return false;
    const from = tierIndexOf(tiers, dragKey);
    if (from < 0) return false;
    if (target.kind === "tier") return tiers[from].id !== target.tierId;
    // 独占一层时，它前后两个间隙重建的是同一层
    return !(tiers[from].memberKeys.length === 1 && (target.index === from || target.index === from + 1));
  };

  const dropHandlers = (target: RoutingDropTarget) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!isValidTarget(target)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setHover((current) => (sameTarget(current, target) ? current : target));
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setHover((current) => (sameTarget(current, target) ? null : current));
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      if (dragKey && isValidTarget(target)) onMove(dragKey, target);
      setDragKey(null);
      setHover(null);
    },
  });

  const endDrag = () => {
    setDragKey(null);
    setHover(null);
  };

  const tierStateText = (state: RouteTierState | undefined, hasModel: boolean): string => {
    switch (state) {
      case "active":
        return t("routing.tier_active");
      case "standby":
        return t("routing.tier_standby");
      case "cooling":
        return t("routing.tier_cooling");
      case "unknown":
        return t("routing.tier_unknown");
      default:
        return hasModel ? t("routing.tier_skipped_model") : t("routing.tier_skipped");
    }
  };

  const renderGap = (index: number) => {
    const target: RoutingDropTarget = { kind: "gap", index };
    const valid = isValidTarget(target);
    const hovered = sameTarget(hover, target);
    return (
      <li key={`gap-${index}`} aria-hidden className="relative h-3">
        <div
          {...dropHandlers(target)}
          className={cn(
            "absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full transition-colors",
            hovered && valid ? "bg-primary" : dragKey && valid ? "bg-primary/25" : "bg-transparent",
          )}
        />
      </li>
    );
  };

  return (
    <ol className="min-w-0" aria-label={t("routing.ladder_label")}>
      {renderGap(0)}
      {tiers.map((tier, index) => {
        const route = routes.get(tier.id);
        const target: RoutingDropTarget = { kind: "tier", tierId: tier.id };
        const valid = isValidTarget(target);
        const hovered = sameTarget(hover, target);
        const firstKey = tier.memberKeys[0];
        const priority = firstKey ? (priorities[firstKey] ?? members.get(firstKey)?.priority) : undefined;
        return (
          <Fragment key={tier.id}>
            <li>
              <section
                {...dropHandlers(target)}
                aria-label={t("routing.tier_label", { index: index + 1, count: tier.memberKeys.length })}
                className={cn(
                  "overflow-hidden rounded-xl ring-1 transition-colors",
                  TIER_STATE_CLASS[route?.state ?? "standby"],
                  hovered && valid && "ring-2 ring-primary/60",
                )}
              >
                <header className="flex items-center gap-3 border-b border-border/60 px-3.5 py-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 font-mono text-[10px] font-semibold text-muted-foreground">
                    {priority === undefined ? "P?" : `P${priority}`}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium">{t("routing.tier_heading", { index: index + 1 })}</h3>
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      {t("routing.tier_count", { count: tier.memberKeys.length })}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn("shrink-0 text-[10px] font-normal", TIER_BADGE_CLASS[route?.state ?? "standby"])}
                  >
                    {tierStateText(route?.state, Boolean(model))}
                  </Badge>
                </header>
                <ul className="divide-y divide-border/60">
                  {tier.memberKeys.map((key) => {
                    const member = members.get(key);
                    if (!member) return null;
                    return (
                      <MemberRow
                        key={key}
                        member={member}
                        state={route?.members.find((item) => item.key === key)?.state}
                        share={route?.members.find((item) => item.key === key)?.share ?? null}
                        cooldown={activeCooldownSeconds(member, model, nowMs, board.receivedAtMs)}
                        strategy={strategy}
                        weights={draft.weights[key] ?? []}
                        canUp={canStepMember(tiers, key, "up")}
                        canDown={canStepMember(tiers, key, "down")}
                        dragging={dragKey === key}
                        disabled={disabled || member.locked}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", key);
                          setDragKey(key);
                        }}
                        onDragEnd={endDrag}
                        onStep={(direction) => onStep(key, direction)}
                        onEditWeights={() => onEditWeights(key)}
                      />
                    );
                  })}
                </ul>
              </section>
            </li>
            {renderGap(index + 1)}
          </Fragment>
        );
      })}
      {tiers.length === 0 && (
        <li className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
          {t("routing.empty")}
        </li>
      )}
    </ol>
  );
}
