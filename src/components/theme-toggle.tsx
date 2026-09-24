import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";

const THEMES = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
];

export function ThemeToggle() {
  const { theme = "system", setTheme } = useTheme();
  const current = THEMES.find((t) => t.value === theme) ?? THEMES[2];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<SidebarMenuButton aria-label="切换主题" />}>
        <current.icon />
        <span>主题：{current.label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="min-w-36">
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(String(value))}>
          {THEMES.map((t) => (
            <DropdownMenuRadioItem key={t.value} value={t.value}>
              <t.icon />
              {t.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
