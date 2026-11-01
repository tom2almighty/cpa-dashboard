import type { TFunction } from "i18next";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/i18n/context";
import {
  clampWeight,
  ROUTING_STRATEGIES,
  ROUTING_WEIGHT_MAX,
  type RoutingBoard,
  type RoutingMember,
  type RoutingPlan,
  type RoutingSettings,
  type RoutingStrategy,
} from "@/lib/routing";
import { cn } from "@/lib/utils";

const strategyKey = (strategy: RoutingStrategy) => strategy.replace(/-/g, "_");

export function PolicyPanel({
  settings,
  disabled,
  onChange,
}: {
  settings: RoutingSettings;
  disabled: boolean;
  onChange: (next: RoutingSettings) => void;
}) {
  const { t } = useI18n();
  const update = (patch: Partial<RoutingSettings>) => onChange({ ...settings, ...patch });

  const readCount = (value: string): number => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 0;
    return Math.min(1000, Math.max(0, parsed));
  };

  return (
    <aside className="space-y-5 self-start rounded-lg border bg-card p-4" aria-label={t("routing.policy_title")}>
      <div>
        <h2 className="text-sm font-medium">{t("routing.policy_title")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("routing.policy_desc")}</p>
      </div>

      <section className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">{t("routing.strategy_label")}</h3>
        <ToggleGroup
          orientation="vertical"
          value={[settings.strategy]}
          onValueChange={(value) => {
            const next = value[0] as RoutingStrategy | undefined;
            if (next && ROUTING_STRATEGIES.includes(next)) update({ strategy: next });
          }}
          disabled={disabled}
          className="w-full"
          spacing={2}
        >
          {ROUTING_STRATEGIES.map((strategy) => (
            <ToggleGroupItem
              key={strategy}
              value={strategy}
              className={cn(
                "h-auto w-full items-start justify-start rounded-md border border-transparent px-2.5 py-2 text-left hover:bg-muted",
                "aria-pressed:border-border aria-pressed:bg-muted aria-pressed:text-foreground",
              )}
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-xs font-medium">{t(`routing.strategy_${strategyKey(strategy)}` as never)}</span>
                <span className="text-[10px] font-normal text-muted-foreground">
                  {t(`routing.strategy_${strategyKey(strategy)}_desc` as never)}
                </span>
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </section>

      <section className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xs font-medium">{t("routing.session_affinity")}</h3>
          <p className="mt-1 text-[10px] text-muted-foreground">{t("routing.session_affinity_desc")}</p>
        </div>
        <Switch
          checked={settings.sessionAffinity}
          disabled={disabled}
          aria-label={t("routing.session_affinity")}
          onCheckedChange={(checked) => update({ sessionAffinity: checked })}
        />
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-medium text-muted-foreground">{t("routing.retry_label")}</h3>
        <label htmlFor="routing-request-retry" className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-xs">{t("routing.request_retry")}</span>
            <span className="block text-[10px] text-muted-foreground">{t("routing.request_retry_desc")}</span>
          </span>
          <Input
            id="routing-request-retry"
            type="number"
            min={0}
            max={100}
            value={settings.requestRetry}
            disabled={disabled}
            aria-label={t("routing.request_retry")}
            onChange={(event) => update({ requestRetry: Math.min(100, readCount(event.target.value)) })}
            className="h-7 w-16 shrink-0 text-right text-xs tabular-nums"
          />
        </label>
        <label htmlFor="routing-max-retry-credentials" className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-xs">{t("routing.max_retry_credentials")}</span>
            <span className="block text-[10px] text-muted-foreground">{t("routing.max_retry_credentials_desc")}</span>
          </span>
          <Input
            id="routing-max-retry-credentials"
            type="number"
            min={0}
            max={1000}
            value={settings.maxRetryCredentials}
            disabled={disabled}
            aria-label={t("routing.max_retry_credentials")}
            onChange={(event) => update({ maxRetryCredentials: readCount(event.target.value) })}
            className="h-7 w-16 shrink-0 text-right text-xs tabular-nums"
          />
        </label>
      </section>
    </aside>
  );
}

export function WeightsDialog({
  member,
  initial,
  onClose,
  onSave,
}: {
  member: RoutingMember;
  initial: readonly (number | null)[];
  onClose: () => void;
  onSave: (weights: (number | null)[]) => void;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState<string[]>(() => initial.map((value) => (value === null ? "" : String(value))));
  const parsed = values.map((value) => (value.trim() === "" ? null : Number(value)));
  const invalid = parsed.some(
    (value) => value !== null && (!Number.isInteger(value) || value < 0 || value > ROUTING_WEIGHT_MAX),
  );
  const changed = values.some(
    (value, index) => (value.trim() === "" ? null : Number(value)) !== (initial[index] ?? null),
  );

  const submit = () => {
    if (invalid) return;
    onSave(values.map((value) => (value.trim() === "" ? null : clampWeight(Number(value)))));
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("routing.weights_title", { name: member.name })}</DialogTitle>
          <DialogDescription>{t("routing.weights_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-1">
          {member.weights.map((slot, index) => (
            <label key={slot.index} htmlFor={`routing-weight-${slot.index}`} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={slot.label}>
                {slot.label || t("routing.weight_slot", { index: index + 1 })}
              </span>
              <Input
                id={`routing-weight-${slot.index}`}
                type="number"
                min={0}
                max={ROUTING_WEIGHT_MAX}
                inputMode="numeric"
                value={values[index] ?? ""}
                placeholder="1"
                aria-label={t("routing.weight_slot", { index: index + 1 })}
                onChange={(event) =>
                  setValues((current) =>
                    current.map((value, position) => (position === index ? event.target.value : value)),
                  )
                }
                className="h-7 w-24 shrink-0 text-right text-xs tabular-nums"
              />
            </label>
          ))}
          {invalid && <p className="text-xs text-destructive">{t("routing.weight_invalid")}</p>}
          <p className="text-[10px] text-muted-foreground">{t("routing.weights_hint")}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={invalid || !changed} onClick={submit}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function settingValue(
  t: TFunction,
  field: keyof RoutingSettings,
  value: RoutingSettings[keyof RoutingSettings],
): string {
  if (field === "strategy") return t(`routing.strategy_${strategyKey(value as RoutingStrategy)}` as never);
  if (field === "sessionAffinity") return value ? t("common.enabled") : t("routing.disabled");
  return String(value);
}

const SETTING_LABEL: Record<keyof RoutingSettings, string> = {
  strategy: "routing.strategy_label",
  sessionAffinity: "routing.session_affinity",
  requestRetry: "routing.request_retry",
  maxRetryCredentials: "routing.max_retry_credentials",
};

export function ReviewDialog({
  board,
  plan,
  pending,
  onClose,
  onConfirm,
}: {
  board: RoutingBoard;
  plan: RoutingPlan;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const names = new Map(board.members.map((member) => [member.key, member]));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("routing.review_title")}</DialogTitle>
          <DialogDescription>{t("routing.review_desc", { count: plan.changes.length })}</DialogDescription>
        </DialogHeader>
        <ul className="max-h-80 space-y-1.5 overflow-y-auto rounded-md border bg-muted/20 p-2.5 text-xs">
          {plan.changes.map((change) => {
            if (change.kind === "setting") {
              return (
                <li key={`s-${change.field}`} className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{t(SETTING_LABEL[change.field] as never)}</span>
                  <span className="font-mono tabular-nums">
                    {settingValue(t, change.field, change.from)} → {settingValue(t, change.field, change.to)}
                  </span>
                </li>
              );
            }
            const member = names.get(change.memberKey);
            if (!member) return null;
            if (change.kind === "priority") {
              return (
                <li key={`p-${change.memberKey}`} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">{member.name}</span>
                  <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                    P{change.from} → P{change.to}
                  </span>
                </li>
              );
            }
            const slot = member.weights[change.index];
            return (
              <li key={`w-${change.memberKey}-${change.index}`} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate">
                  {member.name}
                  {member.weights.length > 1 && (
                    <span className="text-muted-foreground"> · {slot?.label || `#${change.index + 1}`}</span>
                  )}
                </span>
                <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                  {change.from ?? 1} → {change.to ?? 1}
                </span>
              </li>
            );
          })}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button onClick={onConfirm} disabled={pending || plan.changes.length === 0}>
            {pending ? t("routing.saving") : t("routing.confirm_save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
