import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Globe, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CodeEditor } from "@/components/code-editor";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/context";
import { api, configPath, configQuery, errorText } from "@/lib/api";
import type { ConfigField, Plugin } from "@/lib/plugins";
import { defaultHint, fieldsOf, fromForm, kindOf, refreshPlugins, toForm } from "./shared";

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: ConfigField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const id = `plugin-field-${field.name}`;
  const kind = kindOf(field);
  let control: React.ReactNode;
  if (kind === "bool") {
    control = <Switch id={id} checked={value === true} onCheckedChange={onChange} />;
  } else if (kind === "enum") {
    const items = (field.enum_values ?? []).map((v) => ({ value: v, label: v }));
    control = (
      <Select
        items={items}
        value={value === undefined || value === null ? null : String(value)}
        onValueChange={onChange}
      >
        <SelectTrigger id={id} className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  } else if (kind === "json") {
    control = (
      <Textarea
        id={id}
        rows={3}
        spellCheck={false}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.type === "array" ? "[]" : "{}"}
        className="font-mono text-xs"
      />
    );
  } else {
    control = (
      <Input
        id={id}
        inputMode={kind === "number" ? "decimal" : undefined}
        value={value === undefined || value === null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value)}
        placeholder={defaultHint(field)}
        className={kind === "number" ? "w-32" : "w-full sm:w-72"}
      />
    );
  }
  return (
    <div
      className={`flex flex-col gap-2 py-3 ${kind === "json" ? "" : "sm:flex-row sm:items-center sm:justify-between"}`}
    >
      <div className="min-w-0">
        <Label htmlFor={id} className="font-mono text-sm">
          {field.name}
        </Label>
        {field.description && <p className="mt-0.5 text-sm text-muted-foreground">{field.description}</p>}
      </div>
      <div className={kind === "json" ? "" : "shrink-0"}>{control}</div>
    </div>
  );
}

export function ConfigDialog({ plugin, onClose }: { plugin: Plugin; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const fields = fieldsOf(plugin);
  const [asJson, setAsJson] = useState(false);
  const useForm = fields.length > 0 && !asJson;
  // 没配置过的插件在 configs 下没有节点,按空对象编辑
  const { data, error } = useQuery({
    ...configQuery,
    select: (c) =>
      ((c.plugins as { configs?: Record<string, unknown> } | null)?.configs?.[plugin.id] ?? {}) as Record<
        string,
        unknown
      >,
  });
  useEffect(() => {
    if (!data) return;
    setDraft(JSON.stringify(data, null, 2));
    setValues(toForm(fieldsOf(plugin), data));
  }, [data, plugin]);

  const save = useMutation({
    mutationFn: () => {
      const value = useForm ? fromForm(fields, values) : (JSON.parse(draft) as unknown);
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(t("plugins.config_must_be_object"));
      return api(configPath("plugins", "configs", plugin.id), { method: "PUT", body: value });
    },
    onSuccess: () => {
      toast.success(t("plugins.config_saved"));
      refreshPlugins(queryClient);
      onClose();
    },
  });

  function switchMode() {
    try {
      if (asJson) {
        const parsed = JSON.parse(draft) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error(t("plugins.config_must_be_object"));
        setValues(toForm(fields, parsed as Record<string, unknown>));
      } else {
        setDraft(JSON.stringify(fromForm(fields, values), null, 2));
      }
      setAsJson((v) => !v);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("plugins.config_title", { name: plugin.metadata?.name || plugin.id })}</DialogTitle>
        </DialogHeader>
        {fields.length > 0 && (
          <div className="flex justify-end">
            <Button variant="link" size="sm" className="h-auto p-0" onClick={switchMode}>
              {asJson ? t("plugins.edit_as_form") : t("plugins.edit_as_json")}
            </Button>
          </div>
        )}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {errorText(error)}
          </p>
        ) : !data ? (
          <Skeleton className="h-80" />
        ) : useForm ? (
          <div className="max-h-[60svh] divide-y overflow-y-auto">
            {fields.map((f) => (
              <FieldControl
                key={f.name}
                field={f}
                value={values[f.name]}
                onChange={(v) => setValues((cur) => ({ ...cur, [f.name]: v }))}
              />
            ))}
          </div>
        ) : (
          <CodeEditor
            label={t("plugins.config_label")}
            language="json"
            height="20rem"
            value={draft}
            onChange={setDraft}
            onSave={() => save.mutate()}
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => save.mutate()} disabled={!data || save.isPending}>
            {save.isPending && <Spinner />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PluginViewerDialog({
  title,
  subtitle,
  url,
  onClose,
}: {
  title: string;
  subtitle?: string;
  url: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [reloadKey, setReloadKey] = useState(0);
  const [loaded, setLoaded] = useState(false);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[88vh] max-h-[92vh] w-[95vw] max-w-5xl flex-col overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="flex flex-row items-center justify-between border-b px-4 py-2.5 space-y-0">
          <div className="flex items-center gap-2 min-w-0 pr-4">
            <Globe className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <DialogTitle className="truncate text-sm font-semibold">{title}</DialogTitle>
              {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 pr-6">
            <Button
              variant="ghost"
              size="icon-sm"
              title={t("plugins.reload_page")}
              aria-label={t("plugins.reload_page")}
              onClick={() => {
                setLoaded(false);
                setReloadKey((k) => k + 1);
              }}
            >
              <RefreshCw className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title={t("plugins.open_in_new_tab")}
              aria-label={t("plugins.open_in_new_tab")}
              render={
                <a href={url} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" />
                </a>
              }
            />
          </div>
        </DialogHeader>
        <div className="relative flex-1 bg-background">
          {!loaded && (
            <div className="absolute inset-0 grid place-items-center">
              <Spinner className="size-6 text-muted-foreground" />
            </div>
          )}
          <iframe
            key={reloadKey}
            src={url}
            title={title}
            onLoad={() => setLoaded(true)}
            className="size-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
