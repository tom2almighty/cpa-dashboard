import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { type EditorMode, ModeTabs } from "@/components/dual-mode-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/context";
import { formatModelRows, parseModelRows } from "@/lib/provider-form";

type AliasRow = { id: string; name: string; alias: string };

const newAliasRow = (name = "", alias = ""): AliasRow => ({
  id: Math.random().toString(36).slice(2),
  name,
  alias,
});

interface ModelAliasesEditorProps {
  id: string;
  value: string;
  onChange: (text: string) => void;
  label: string;
  hint: string;
  placeholder?: string;
}

/**
 * 模型别名编辑器：可视化逐行编辑「上游模型 => 映射别名」，或切到文本模式批量编辑。
 * 两种模式共享同一份 "name => alias" 文本，切换时无损转换。
 */
export function ModelAliasesEditor({ id, value, onChange, label, hint, placeholder }: ModelAliasesEditorProps) {
  const { t } = useI18n();
  const [textMode, setTextMode] = useState(false);
  const [rows, setRows] = useState<AliasRow[]>(() => {
    const parsed = parseModelRows(value);
    return parsed.length > 0 ? parsed.map((r) => newAliasRow(r.name, r.alias)) : [newAliasRow()];
  });

  const syncRows = (next: AliasRow[]) => {
    const list = next.length > 0 ? next : [newAliasRow()];
    setRows(list);
    onChange(formatModelRows(list.filter((r) => r.name.trim() || r.alias.trim())));
  };

  const setMode = (mode: EditorMode) => {
    const nextText = mode === "text";
    if (nextText === textMode) return;
    if (!nextText) {
      const parsed = parseModelRows(value);
      setRows(parsed.length > 0 ? parsed.map((r) => newAliasRow(r.name, r.alias)) : [newAliasRow()]);
    }
    setTextMode(nextText);
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Label htmlFor={id}>{label}</Label>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{hint}</p>
        </div>
        <ModeTabs mode={textMode ? "text" : "visual"} onChange={setMode} />
      </div>

      {textMode ? (
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-20 font-mono text-xs leading-relaxed"
          placeholder={placeholder || "claude-sonnet-4-5 => cs4.5"}
        />
      ) : (
        <div className="grid gap-1.5">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-1 text-xs font-medium text-muted-foreground">
            <span>{t("providers.upstream_model")}</span>
            <span>{t("providers.mapped_alias")}</span>
            <span className="w-7" />
          </div>
          <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {rows.map((row, index) => (
              <li key={row.id} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                <Input
                  value={row.name}
                  onChange={(e) =>
                    syncRows(rows.map((item) => (item.id === row.id ? { ...item, name: e.target.value } : item)))
                  }
                  placeholder={t("providers.enter_model")}
                  aria-label={`${t("providers.upstream_model")} #${index + 1}`}
                  className="font-mono text-xs"
                />
                <Input
                  value={row.alias}
                  onChange={(e) =>
                    syncRows(rows.map((item) => (item.id === row.id ? { ...item, alias: e.target.value } : item)))
                  }
                  placeholder={t("providers.alias_placeholder")}
                  aria-label={`${t("providers.mapped_alias")} #${index + 1}`}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="justify-self-end text-muted-foreground hover:text-destructive"
                  aria-label={t("models.delete_row")}
                  disabled={rows.length <= 1 && !row.name && !row.alias}
                  onClick={() => syncRows(rows.filter((item) => item.id !== row.id))}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-self-start"
            onClick={() => syncRows([...rows, newAliasRow()])}
          >
            <Plus className="size-3.5" />
            {t("models.add_row")}
          </Button>
        </div>
      )}
    </div>
  );
}
