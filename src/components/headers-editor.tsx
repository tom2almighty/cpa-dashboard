import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/context";
import { formatHeaderRows, type HeaderRow, newHeaderRow, parseHeaderRows } from "@/lib/provider-form";

interface HeadersEditorProps {
  id: string;
  value: string;
  onChange: (text: string) => void;
  label: string;
  hint: string;
}

/**
 * 额外请求头编辑器：可视化逐行添加键值对，或切到文本模式批量编辑。
 * 两种模式共用同一份 "名称: 值" 文本，切换时不做有损转换。
 */
export function HeadersEditor({ id, value, onChange, label, hint }: HeadersEditorProps) {
  const { t } = useI18n();
  const [textMode, setTextMode] = useState(false);
  // 始终保留至少一行,避免空列表时每帧新建行对象导致输入框失焦
  const [rows, setRows] = useState<HeaderRow[]>(() => {
    const parsed = parseHeaderRows(value);
    return parsed.length > 0 ? parsed : [newHeaderRow()];
  });

  const syncRows = (next: HeaderRow[]) => {
    const list = next.length > 0 ? next : [newHeaderRow()];
    setRows(list);
    onChange(formatHeaderRows(list));
  };

  const toggleMode = () => {
    if (textMode) {
      const parsed = parseHeaderRows(value);
      setRows(parsed.length > 0 ? parsed : [newHeaderRow()]);
    }
    setTextMode(!textMode);
  };

  const visible = rows;

  return (
    <div className="grid gap-2">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{hint}</p>
      </div>

      {/* 与页面其它位置一致的 tabs 切换：可视化逐行编辑 / 文本批量编辑 */}
      <Tabs
        value={textMode ? "text" : "list"}
        onValueChange={(v) => {
          const next = v === "text";
          if (next === textMode) return;
          toggleMode();
        }}
      >
        <TabsList className="h-7 p-0.5">
          <TabsTrigger value="list" className="px-2 text-xs">
            {t("providers.list_mode")}
          </TabsTrigger>
          <TabsTrigger value="text" className="px-2 text-xs">
            {t("providers.text_mode")}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {textMode ? (
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-16 font-mono text-sm"
          placeholder={"X-Custom-Header: custom-value"}
        />
      ) : (
        <div className="grid gap-1.5">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-1 text-xs font-medium text-muted-foreground">
            <span>{t("providers.header_name")}</span>
            <span>{t("providers.header_value")}</span>
            <span className="w-7" />
          </div>
          <ul className="space-y-1.5">
            {visible.map((row, index) => (
              <li key={row.id} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                <Input
                  value={row.key}
                  onChange={(e) =>
                    syncRows(visible.map((item) => (item.id === row.id ? { ...item, key: e.target.value } : item)))
                  }
                  placeholder={t("providers.header_name_placeholder")}
                  aria-label={t("providers.header_name_named", { n: index + 1 })}
                  className="font-mono text-xs"
                />
                <Input
                  value={row.value}
                  onChange={(e) =>
                    syncRows(visible.map((item) => (item.id === row.id ? { ...item, value: e.target.value } : item)))
                  }
                  placeholder={t("providers.header_value_placeholder")}
                  aria-label={t("providers.header_value_named", { n: index + 1 })}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="justify-self-end text-muted-foreground hover:text-destructive"
                  aria-label={t("providers.remove_header_named", { n: index + 1 })}
                  disabled={visible.length <= 1}
                  onClick={() => syncRows(visible.filter((item) => item.id !== row.id))}
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
            onClick={() => syncRows([...visible, newHeaderRow()])}
          >
            <Plus className="size-3.5" />
            {t("providers.add_header")}
          </Button>
        </div>
      )}
    </div>
  );
}
