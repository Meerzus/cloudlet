import { ColorPalette } from "@/components/ui/color-palette/color-palette";

export function OklchPalette() {
  return <ColorPalette defaultColors={["oklch(51.9% 0.203 263.2)", "oklch(81.7% 0.14 80.1)"]} defaultFormat="oklch" />;
}
