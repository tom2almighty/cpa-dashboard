import { useState } from "react";
import { EmptyRow, SkeletonRows } from "@/components/table-rows";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/i18n/context";
import { errorText } from "@/lib/api";
import { CHANNELS, useCatalog } from "./shared";

// ---------- 模型目录 ----------

export function Catalog() {
  const { t } = useI18n();
  const [channel, setChannel] = useState(CHANNELS[0]);
  const { data, isPending, isError, error } = useCatalog(channel);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("models.catalog_hint")}</p>
        <Select
          items={CHANNELS.map((c) => ({ value: c, label: c }))}
          value={channel}
          onValueChange={(v) => v && setChannel(v)}
        >
          <SelectTrigger className="w-44" aria-label={t("models.select_channel")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHANNELS.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("models.th_model")}</TableHead>
            <TableHead className="hidden sm:table-cell">{t("models.display_name")}</TableHead>
            <TableHead className="hidden sm:table-cell">{t("models.th_owner")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <SkeletonRows columns={3} />
          ) : isError ? (
            <EmptyRow columns={3}>{t("models.catalog_error", { message: errorText(error) })}</EmptyRow>
          ) : data.length === 0 ? (
            <EmptyRow columns={3}>{t("models.no_models")}</EmptyRow>
          ) : (
            data.map((m) => (
              <TableRow key={m.id}>
                {/* 模型 ID 本身可能很长，窄屏把显示名称与提供方折到它下面，避免整表横向滚动 */}
                <TableCell className="font-mono text-sm">
                  <span className="block break-all whitespace-normal">{m.id}</span>
                  <span className="mt-0.5 block font-sans text-xs font-normal text-muted-foreground sm:hidden">
                    {[m.display_name, m.owned_by].filter(Boolean).join(" · ")}
                  </span>
                </TableCell>
                <TableCell className="hidden sm:table-cell">{m.display_name || "—"}</TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">{m.owned_by || "—"}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </>
  );
}
