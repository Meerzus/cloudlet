import { ColorPalette } from "@/components/ui/color-palette/color-palette";

export function TranslucentPalette() {
  return <ColorPalette defaultColors={["rgb(36 92 219 / 0.6)", "rgb(242 184 75)"]} defaultFormat="rgb" alpha />;
}
