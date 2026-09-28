import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { type Language, useI18n } from "@/i18n/context";

const LANGUAGES: { value: Language; label: string }[] = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" },
];

export function LanguageToggle({ mode = "sidebar" }: { mode?: "sidebar" | "button" }) {
  const { language, setLanguage, t } = useI18n();
  const current = LANGUAGES.find((l) => l.value === language) ?? LANGUAGES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          mode === "sidebar" ? (
            <SidebarMenuButton aria-label={t("language.title")}>
              <Languages className="size-4" />
              <span>
                {t("language.title")}：{current.label}
              </span>
            </SidebarMenuButton>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("language.title")}
              className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Languages className="size-3.5" />
              <span>{current.label}</span>
            </Button>
          )
        }
      />
      <DropdownMenuContent side={mode === "sidebar" ? "right" : "bottom"} align="end" className="min-w-32">
        <DropdownMenuRadioGroup value={language} onValueChange={(val) => setLanguage(val as Language)}>
          {LANGUAGES.map((l) => (
            <DropdownMenuRadioItem key={l.value} value={l.value}>
              {l.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
