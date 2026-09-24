import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usePreset } from "@/lib/preset";
import { PRESETS, type Preset } from "@/lib/range";

export function RangePicker() {
  const [preset, setPreset] = usePreset();
  return (
    <ToggleGroup
      variant="outline"
      size="sm"
      spacing={0}
      aria-label="时间范围"
      value={[preset]}
      onValueChange={(value) => {
        if (value[0]) setPreset(value[0] as Preset);
      }}
    >
      {PRESETS.map((p) => (
        <ToggleGroupItem key={p.value} value={p.value} className="px-3">
          {p.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
