import { ColorPickerPanel } from "@/components/ui/color-picker/color-picker";

export function WithOpacity() {
  return <ColorPickerPanel defaultColor="rgb(36 92 219 / 0.6)" defaultFormat="rgb" alpha />;
}
