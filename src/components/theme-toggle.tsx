import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { useI18n } from "@/i18n/context";

export function ThemeToggle({ mode = "sidebar" }: { mode?: "sidebar" | "button" }) {
  const { theme = "system", setTheme } = useTheme();
  const { t } = useI18n();

  const themes = [
    { value: "light", label: t("theme.light"), icon: Sun },
    { value: "dark", label: t("theme.dark"), icon: Moon },
    { value: "system", label: t("theme.system"), icon: Monitor },
  ];

  const current = themes.find((item) => item.value === theme) ?? themes[2];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          mode === "sidebar" ? (
            <SidebarMenuButton aria-label={t("theme.title")}>
              <current.icon />
              <span>
                {t("theme.title")}：{current.label}
              </span>
            </SidebarMenuButton>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("theme.title")}
              className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <current.icon className="size-3.5" />
              <span>{current.label}</span>
            </Button>
          )
        }
      />
      <DropdownMenuContent side={mode === "sidebar" ? "right" : "bottom"} align="end" className="min-w-36">
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(String(value))}>
          {themes.map((item) => (
            <DropdownMenuRadioItem key={item.value} value={item.value}>
              <item.icon />
              {item.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
