import { ColorPicker } from "@/components/ui/color-picker/color-picker";

export function HexOnly() {
  return <ColorPicker defaultColor="#245cdb" formats={["hex"]} labels={{ open: "Pick a hex color" }} />;
}
