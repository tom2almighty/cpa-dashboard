import { Plus, X } from "lucide-react";
import { useState } from "react";
import { type EditorMode, ModeTabs } from "@/components/dual-mode-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/context";
import { lines } from "@/lib/provider-form";

interface ExcludedModelsEditorProps {
  id: string;
  value: string;
  onChange: (text: string) => void;
  label: string;
  hint: string;
  placeholder?: string;
}

/**
 * 排除模型编辑器：可视化标签管理排除规则（支持通配符），或切到文本模式批量编辑。
 * 两种模式共享同一份换行分隔规则文本，切换时无损转换。
 */
export function ExcludedModelsEditor({ id, value, onChange, label, hint, placeholder }: ExcludedModelsEditorProps) {
  const { t } = useI18n();
  const [textMode, setTextMode] = useState(false);
  const [newRule, setNewRule] = useState("");

  const rules = lines(value);

  const syncRules = (next: string[]) => {
    onChange(next.join("\n"));
  };

  const handleAddRule = () => {
    const trimmed = newRule.trim();
    if (!trimmed) return;
    const splitRules = trimmed
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const set = new Set(rules);
    for (const r of splitRules) {
      set.add(r);
    }
    syncRules(Array.from(set));
    setNewRule("");
  };

  const handleRemoveRule = (rule: string) => {
    syncRules(rules.filter((r) => r !== rule));
  };

  const handleClearAll = () => {
    syncRules([]);
  };

  const setMode = (mode: EditorMode) => {
    setTextMode(mode === "text");
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
          placeholder={placeholder || "claude-3-5-haiku-20241022\n*-mini"}
        />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">{t("models.rules_count", { count: rules.length })}</span>
            {rules.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                className="text-xs text-destructive hover:underline cursor-pointer"
              >
                {t("models.clear_all")}
              </button>
            )}
          </div>

          {rules.length === 0 ? (
            <div className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
              {t("models.no_rules_short") || t("models.no_rules")}
            </div>
          ) : (
            <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto rounded-lg border bg-muted/20 p-2.5">
              {rules.map((rule) => (
                <span
                  key={rule}
                  className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-0.5 font-mono text-xs text-destructive"
                >
                  <span>{rule}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveRule(rule)}
                    className="hover:opacity-75 cursor-pointer"
                    aria-label={t("models.remove_rule_aria", { rule })}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Input
              value={newRule}
              onChange={(e) => setNewRule(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddRule();
                }
              }}
              placeholder={t("models.custom_rule_placeholder")}
              className="h-8 font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddRule}
              disabled={!newRule.trim()}
              className="h-8 shrink-0 text-xs"
            >
              <Plus className="size-3.5" />
              {t("common.add")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
