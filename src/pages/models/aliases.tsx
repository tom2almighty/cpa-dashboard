import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/i18n/context";
import { api, CONFIG_KEY, configPath, configQuery, errorText, orNotFound } from "@/lib/api";
import { ALIAS_CHANNELS, type Alias, oauthOf, SuggestInput, useCatalog } from "./shared";

// ---------- 模型别名 ----------

type Row = Alias & { key: number };

/**
 * 别名行的字段包装。窄屏下每个字段自带标签（否则只剩三个光秃秃的输入框），
 * 宽屏用 `sm:contents` 让包装层不生成盒子，字段重新成为行网格的直接子项，布局与之前完全一致。
 */
function AliasField({
  label,
  inline = false,
  children,
}: {
  label: string;
  /** 窄屏下标签与控件同一行（开关用），否则标签在上 */
  inline?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={inline ? "flex items-center justify-between gap-2 sm:contents" : "grid gap-1 sm:contents"}>
      <span className="text-xs text-muted-foreground sm:hidden">{label}</span>
      {children}
    </div>
  );
}

export function AliasDialog({
  channel: initial,
  aliases,
  onClose,
}: {
  channel: string;
  aliases: Alias[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const uid = useId();
  const [channel, setChannel] = useState(initial);
  const [rows, setRows] = useState<Row[]>(() =>
    (aliases.length ? aliases : [{ name: "", alias: "" }]).map((a, i) => ({ ...a, key: i })),
  );
  const catalog = useCatalog(channel);
  const update = (key: number, patch: Partial<Alias>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = useMutation({
    mutationFn: () => {
      const clean = rows
        .filter((r) => r.name.trim() && r.alias.trim())
        .map(({ key: _, ...r }) => {
          const out: Alias = { ...r, name: r.name.trim(), alias: r.alias.trim() };
          if (!out["display-name"]?.trim()) delete out["display-name"];
          if (!out.fork) delete out.fork;
          if (!out["force-mapping"]) delete out["force-mapping"];
          return out;
        });
      // v8: /config/oauth/model-alias/<channel>，数组整体替换;清空时删除,本就不存在也算成功
      const path = configPath("oauth", "model-alias", channel);
      return clean.length
        ? api(path, { method: "PUT", body: clean })
        : api(path, { method: "DELETE" }).catch(orNotFound(null));
    },
    onSuccess: () => {
      toast.success(t("models.alias_saved"));
      queryClient.invalidateQueries({ queryKey: CONFIG_KEY });
      onClose();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (channel) save.mutate();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {initial ? t("models.edit_alias_title", { channel: initial }) : t("models.add_alias_title")}
          </DialogTitle>
        </DialogHeader>
        <form id={`${uid}-form`} onSubmit={submit} className="grid gap-4">
          {!initial && (
            <div className="grid gap-1.5 sm:max-w-xs">
              <Label htmlFor={`${uid}-channel`}>{t("models.channel")}</Label>
              <SuggestInput
                id={`${uid}-channel`}
                value={channel}
                onChange={(v) => setChannel(v.trim().toLowerCase())}
                options={ALIAS_CHANNELS}
                placeholder={t("models.channel_placeholder")}
              />
            </div>
          )}
          <div className="grid gap-2">
            <div className="hidden grid-cols-[1fr_1fr_1fr_auto_auto_auto] gap-2 px-1 text-xs text-muted-foreground sm:grid">
              <span>{t("models.upstream_model")}</span>
              <span>{t("models.alias_name")}</span>
              <span>{t("models.display_name")}</span>
              <span title={t("models.fork_hint")}>{t("models.fork")}</span>
              <span title={t("models.force_mapping_hint")}>{t("models.force_mapping")}</span>
              <span className="w-8" />
            </div>
            {rows.map((r) => (
              <div
                key={r.key}
                className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_1fr_auto_auto_auto] sm:items-center sm:rounded-none sm:border-0 sm:p-0"
              >
                <AliasField label={t("models.upstream_model")}>
                  <SuggestInput
                    id={`${uid}-model-${r.key}`}
                    ariaLabel={t("models.upstream_model")}
                    value={r.name}
                    onChange={(v) => update(r.key, { name: v })}
                    options={(catalog.data ?? []).map((m) => m.id)}
                  />
                </AliasField>
                <AliasField label={t("models.alias_name")}>
                  <Input
                    aria-label={t("models.alias_name")}
                    value={r.alias}
                    onChange={(e) => update(r.key, { alias: e.target.value })}
                    className="font-mono"
                  />
                </AliasField>
                <AliasField label={t("models.display_name")}>
                  <Input
                    aria-label={t("models.display_name")}
                    value={r["display-name"] ?? ""}
                    onChange={(e) => update(r.key, { "display-name": e.target.value })}
                  />
                </AliasField>
                <AliasField label={t("models.fork")} inline>
                  <Switch
                    aria-label={t("models.fork")}
                    className="justify-self-center"
                    checked={r.fork === true}
                    onCheckedChange={(v) => update(r.key, { fork: v })}
                  />
                </AliasField>
                <AliasField label={t("models.force_mapping")} inline>
                  <Switch
                    aria-label={t("models.force_mapping")}
                    className="justify-self-center"
                    checked={r["force-mapping"] === true}
                    onCheckedChange={(v) => update(r.key, { "force-mapping": v })}
                  />
                </AliasField>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="justify-self-end"
                  aria-label={t("models.delete_row")}
                  onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() => setRows((rs) => [...rs, { name: "", alias: "", key: Date.now() }])}
            >
              <Plus />
              {t("models.add_row")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("models.alias_hint")}</p>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={`${uid}-form`} disabled={!channel || save.isPending}>
            {save.isPending && <Spinner />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Aliases() {
  const { t } = useI18n();
  const [editing, setEditing] = useState<{ channel: string; aliases: Alias[] } | null>(null);
  const { data, isPending, isError, error } = useQuery({
    ...configQuery,
    select: (c) => Object.entries(oauthOf(c)["model-alias"] ?? {}).filter(([, list]) => list?.length),
  });

  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("models.load_failed", { message: errorText(error) })}
      </p>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("models.desc_alias")}</p>
        <Button onClick={() => setEditing({ channel: "", aliases: [] })}>
          <Plus />
          {t("models.add_alias")}
        </Button>
      </div>
      {isPending ? (
        <Skeleton className="h-40" />
      ) : data.length === 0 ? (
        <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          {t("models.no_aliases")}
        </p>
      ) : (
        <div className="grid gap-8">
          {data.map(([channel, list]) => (
            <section key={channel} aria-label={channel}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-medium">{channel}</h3>
                <Button variant="ghost" size="sm" onClick={() => setEditing({ channel, aliases: list })}>
                  <Pencil />
                  {t("common.edit")}
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("models.th_alias")}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t("models.upstream_model")}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t("models.display_name")}</TableHead>
                    <TableHead className="w-16">{t("models.th_options")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((a) => (
                    <TableRow key={`${a.name}-${a.alias}`}>
                      {/*
                        四列都带 whitespace-nowrap，窄屏按内容算约 700px，必然横向滚动。
                        这里把上游模型与显示名称折到别名下方，窄屏只留一列主字段。
                      */}
                      <TableCell className="font-mono text-sm">
                        <span className="block">{a.alias}</span>
                        <span className="mt-0.5 block font-sans text-xs font-normal break-all whitespace-normal text-muted-foreground sm:hidden">
                          {[a.name, a["display-name"]].filter(Boolean).join(" · ")}
                        </span>
                      </TableCell>
                      <TableCell className="hidden font-mono text-sm text-muted-foreground sm:table-cell">
                        {a.name}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{a["display-name"] || "—"}</TableCell>
                      <TableCell>
                        {/* 窄屏两个徽章竖排，横向省出一列宽度 */}
                        <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-1.5">
                          {a.fork && <Badge variant="outline">{t("models.fork")}</Badge>}
                          {a["force-mapping"] && <Badge variant="outline">{t("models.force_mapping")}</Badge>}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          ))}
        </div>
      )}
      {editing && <AliasDialog channel={editing.channel} aliases={editing.aliases} onClose={() => setEditing(null)} />}
    </>
  );
}
