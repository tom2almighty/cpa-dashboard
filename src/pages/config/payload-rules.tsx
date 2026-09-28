import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCode, Pencil, Plus, Trash2, Wand2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import YAML from "yaml";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/context";
import { api } from "@/lib/api";
import type { Json } from "./settings";

type PayloadRuleItem = {
  models?: { name: string; protocol?: string; headers?: Record<string, string> }[];
  params?: Record<string, unknown> | string[];
};

type PayloadConfig = {
  default?: PayloadRuleItem[];
  override?: PayloadRuleItem[];
  filter?: PayloadRuleItem[];
};

type EditingRule = {
  section: "default" | "override" | "filter";
  index: number | null;
  modelName: string;
  protocol: string;
  paramsText: string;
};

// 读取当前 config.yaml,改完 payload 段写回,保留其余内容与注释
async function updatePayload(change: (payload: Record<string, unknown[]>) => void) {
  const doc = YAML.parseDocument((await api<string>("/v8/management/config.yaml")) || "");
  const requests = doc.get("requests") as YAML.YAMLMap | undefined;
  const rawPayload = requests ? requests.get("payload") : doc.get("payload");
  const payload = ((rawPayload as { toJSON?: () => unknown } | undefined)?.toJSON?.() ?? {}) as Record<
    string,
    unknown[]
  >;
  change(payload);
  for (const key of Object.keys(payload)) if (!payload[key]?.length) delete payload[key];
  if (requests) {
    if (Object.keys(payload).length === 0) requests.delete("payload");
    else requests.set("payload", payload);
  } else {
    if (Object.keys(payload).length === 0) doc.deleteIn(["requests", "payload"]);
    else doc.setIn(["requests", "payload"], payload);
  }
  await api("/v8/management/config.yaml", {
    method: "PUT",
    body: doc.toString(),
    raw: true,
    headers: { "Content-Type": "application/yaml" },
  });
}

function RuleDialog({
  rule,
  onClose,
  onSave,
  isSaving,
}: {
  rule: EditingRule;
  onClose: () => void;
  onSave: (rule: EditingRule) => void;
  isSaving: boolean;
}) {
  const { t } = useI18n();
  const [section, setSection] = useState<"default" | "override" | "filter">(rule.section);
  const [modelName, setModelName] = useState(rule.modelName);
  const [protocol, setProtocol] = useState(rule.protocol);
  const [paramsText, setParamsText] = useState(rule.paramsText);

  const applyPreset = (preset: {
    section: "default" | "override" | "filter";
    model: string;
    proto: string;
    params: string;
  }) => {
    setSection(preset.section);
    setModelName(preset.model);
    setProtocol(preset.proto);
    setParamsText(preset.params);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      section,
      index: rule.index,
      modelName: modelName.trim() || "*",
      protocol: protocol.trim(),
      paramsText: paramsText.trim(),
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {rule.index !== null ? t("config.payload.dialog_edit") : t("config.payload.dialog_add")}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <Label className="text-xs text-muted-foreground">{t("config.payload.presets")}</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    applyPreset({
                      section: "default",
                      model: "gemini-*",
                      proto: "gemini",
                      params: '{\n  "generationConfig.thinkingConfig.thinkingBudget": 32768\n}',
                    })
                  }
                >
                  <Wand2 className="size-3" />
                  {t("config.payload.preset_gemini_budget")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    applyPreset({
                      section: "override",
                      model: "*",
                      proto: "",
                      params: '{\n  "temperature": 0.7\n}',
                    })
                  }
                >
                  <Wand2 className="size-3" />
                  {t("config.payload.preset_global_temp")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    applyPreset({
                      section: "filter",
                      model: "gemini-*",
                      proto: "gemini",
                      params: "generationConfig.thinkingConfig.thinkingBudget",
                    })
                  }
                >
                  <Wand2 className="size-3" />
                  {t("config.payload.preset_filter_budget")}
                </Button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="rule-section">{t("config.payload.rule_type")}</Label>
                <Select
                  items={[
                    { value: "default", label: t("config.payload.section_default_full") },
                    { value: "override", label: t("config.payload.section_override_full") },
                    { value: "filter", label: t("config.payload.section_filter_full") },
                  ]}
                  value={section}
                  onValueChange={(v) => v && setSection(v as "default" | "override" | "filter")}
                >
                  <SelectTrigger id="rule-section" className="mt-1 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">{t("config.payload.section_default")}</SelectItem>
                    <SelectItem value="override">{t("config.payload.section_override")}</SelectItem>
                    <SelectItem value="filter">{t("config.payload.section_filter")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="rule-protocol">{t("config.payload.protocol")}</Label>
                <Select
                  items={[
                    { value: "all", label: t("config.payload.protocol_all") },
                    { value: "gemini", label: "Gemini" },
                    { value: "openai", label: "OpenAI" },
                    { value: "claude", label: "Claude" },
                    { value: "codex", label: "Codex" },
                    { value: "antigravity", label: "Antigravity" },
                  ]}
                  value={protocol || "all"}
                  onValueChange={(v) => setProtocol(v && v !== "all" ? v : "")}
                >
                  <SelectTrigger id="rule-protocol" className="mt-1 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("config.payload.protocol_all")}</SelectItem>
                    <SelectItem value="gemini">Gemini</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="claude">Claude</SelectItem>
                    <SelectItem value="codex">Codex</SelectItem>
                    <SelectItem value="antigravity">Antigravity</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="rule-model">{t("config.payload.model")}</Label>
              <Input
                id="rule-model"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder={t("config.payload.model_placeholder")}
                className="mt-1 font-mono text-sm"
                required
              />
            </div>

            <div>
              <Label htmlFor="rule-params">
                {section === "filter" ? t("config.payload.filter_params") : t("config.payload.json_params")}
              </Label>
              <Textarea
                id="rule-params"
                value={paramsText}
                onChange={(e) => setParamsText(e.target.value)}
                placeholder={
                  section === "filter"
                    ? "generationConfig.thinkingConfig.thinkingBudget\ngenerationConfig.responseJsonSchema"
                    : '{\n  "generationConfig.thinkingConfig.thinkingBudget": 32768\n}'
                }
                className="mt-1 min-h-32 font-mono text-xs"
                required
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {section === "filter" ? t("config.payload.filter_hint") : t("config.payload.json_hint")}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Spinner />}
              {t("config.payload.save_rule")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RuleCard({
  title,
  description,
  badge,
  section,
  rules,
  onAdd,
  onEdit,
  onDelete,
}: {
  title: string;
  description: string;
  badge: string;
  section: "default" | "override" | "filter";
  rules: PayloadRuleItem[] | undefined;
  onAdd: () => void;
  onEdit: (rule: PayloadRuleItem, index: number) => void;
  onDelete: (index: number) => void;
}) {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
            <Badge variant="outline">{badge}</Badge>
          </div>
          <Button size="xs" variant="outline" onClick={onAdd}>
            <Plus className="size-3" />
            {t("common.add")}
          </Button>
        </div>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!rules?.length ? (
          <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            {t("config.payload.empty")}
          </div>
        ) : (
          rules.map((rule, idx) => {
            const ruleKey = `${section}-${idx}-${rule.models?.map((m) => `${m.name}:${m.protocol ?? ""}`).join("|") || "all"}`;
            return (
              <div key={ruleKey} className="rounded-lg border bg-muted/20 p-3 text-xs space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-muted-foreground font-medium">{t("config.payload.target_models")}</span>
                    {rule.models?.length ? (
                      rule.models.map((m) => (
                        <Badge key={`${m.name}-${m.protocol ?? ""}`} variant="secondary" className="font-mono text-xs">
                          {m.name}
                          {m.protocol && <span className="ml-1 opacity-70">({m.protocol})</span>}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-muted-foreground">{t("config.payload.match_all")}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={t("config.payload.edit_rule")}
                      onClick={() => onEdit(rule, idx)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={t("config.payload.delete_rule")}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => onDelete(idx)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>

                {rule.params && (
                  <div>
                    <span className="text-muted-foreground font-medium">{t("config.payload.param_rules")}</span>
                    <pre className="mt-1 overflow-x-auto rounded bg-muted/50 p-2 font-mono text-xs text-foreground">
                      {Array.isArray(rule.params) ? rule.params.join("\n") : JSON.stringify(rule.params, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

export function PayloadRules({ onGoYaml }: { onGoYaml: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [dialogRule, setDialogRule] = useState<EditingRule | null>(null);

  const { data: configData, isPending } = useQuery({
    queryKey: ["cpa", "config"],
    queryFn: () => api<Json>("/v8/management/config"),
  });

  const saveMutation = useMutation({
    mutationFn: async (rule: EditingRule) => {
      let parsedParams: Record<string, unknown> | string[] = {};
      if (rule.section === "filter") {
        parsedParams = rule.paramsText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        try {
          parsedParams = JSON.parse(rule.paramsText);
        } catch {
          throw new Error(t("config.payload.invalid_json"));
        }
      }

      const ruleItem: PayloadRuleItem = {
        models: [{ name: rule.modelName, ...(rule.protocol ? { protocol: rule.protocol } : {}) }],
        params: parsedParams,
      };
      await updatePayload((payload) => {
        payload[rule.section] ??= [];
        const list = payload[rule.section];
        if (rule.index !== null && rule.index < list.length) list[rule.index] = ruleItem;
        else list.push(ruleItem);
      });
    },
    onSuccess: () => {
      toast.success(t("config.payload.updated"));
      queryClient.invalidateQueries({ queryKey: ["cpa", "config"] });
      queryClient.invalidateQueries({ queryKey: ["cpa", "config.yaml"] });
      setDialogRule(null);
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const deleteRule = async (section: "default" | "override" | "filter", index: number) => {
    try {
      await updatePayload((payload) => {
        payload[section]?.splice(index, 1);
      });
      toast.success(t("config.payload.deleted"));
      queryClient.invalidateQueries({ queryKey: ["cpa", "config"] });
      queryClient.invalidateQueries({ queryKey: ["cpa", "config.yaml"] });
    } catch (e) {
      toast.error(t("config.payload.delete_failed", { message: (e as Error).message }));
    }
  };

  const payload = (configData?.payload as PayloadConfig | undefined) ?? {};

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">{t("config.payload.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("config.payload.desc")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() =>
              setDialogRule({
                section: "default",
                index: null,
                modelName: "gemini-*",
                protocol: "gemini",
                paramsText: '{\n  "generationConfig.thinkingConfig.thinkingBudget": 32768\n}',
              })
            }
          >
            <Plus className="size-4" />
            {t("config.payload.add_rule")}
          </Button>
          <Button variant="outline" size="sm" onClick={onGoYaml}>
            <FileCode className="size-4" />
            {t("config.payload.view_source")}
          </Button>
        </div>
      </div>

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <RuleCard
            title={t("config.payload.default_title")}
            description={t("config.payload.default_desc")}
            badge="Default"
            section="default"
            rules={payload.default}
            onAdd={() =>
              setDialogRule({
                section: "default",
                index: null,
                modelName: "gemini-*",
                protocol: "gemini",
                paramsText: '{\n  "generationConfig.thinkingConfig.thinkingBudget": 32768\n}',
              })
            }
            onEdit={(rule, index) =>
              setDialogRule({
                section: "default",
                index,
                modelName: rule.models?.[0]?.name ?? "*",
                protocol: rule.models?.[0]?.protocol ?? "",
                paramsText: JSON.stringify(rule.params ?? {}, null, 2),
              })
            }
            onDelete={(index) => deleteRule("default", index)}
          />

          <RuleCard
            title={t("config.payload.override_title")}
            description={t("config.payload.override_desc")}
            badge="Override"
            section="override"
            rules={payload.override}
            onAdd={() =>
              setDialogRule({
                section: "override",
                index: null,
                modelName: "*",
                protocol: "",
                paramsText: '{\n  "temperature": 0.7\n}',
              })
            }
            onEdit={(rule, index) =>
              setDialogRule({
                section: "override",
                index,
                modelName: rule.models?.[0]?.name ?? "*",
                protocol: rule.models?.[0]?.protocol ?? "",
                paramsText: JSON.stringify(rule.params ?? {}, null, 2),
              })
            }
            onDelete={(index) => deleteRule("override", index)}
          />

          <div className="md:col-span-2">
            <RuleCard
              title={t("config.payload.filter_title")}
              description={t("config.payload.filter_desc")}
              badge="Filter"
              section="filter"
              rules={payload.filter}
              onAdd={() =>
                setDialogRule({
                  section: "filter",
                  index: null,
                  modelName: "gemini-*",
                  protocol: "gemini",
                  paramsText: "generationConfig.thinkingConfig.thinkingBudget",
                })
              }
              onEdit={(rule, index) =>
                setDialogRule({
                  section: "filter",
                  index,
                  modelName: rule.models?.[0]?.name ?? "*",
                  protocol: rule.models?.[0]?.protocol ?? "",
                  paramsText: Array.isArray(rule.params) ? rule.params.join("\n") : "",
                })
              }
              onDelete={(index) => deleteRule("filter", index)}
            />
          </div>
        </div>
      )}

      {dialogRule && (
        <RuleDialog
          rule={dialogRule}
          onClose={() => setDialogRule(null)}
          onSave={(updated) => saveMutation.mutate(updated)}
          isSaving={saveMutation.isPending}
        />
      )}
    </div>
  );
}
