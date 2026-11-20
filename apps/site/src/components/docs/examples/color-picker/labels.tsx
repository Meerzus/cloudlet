import { ColorPicker, type ColorPickerLabels } from "@/components/ui/color-picker/color-picker";

const labels: ColorPickerLabels = {
  open: "Farbe wählen",
  panel: "Farbwähler",
  close: "Schließen",
  area: "Sättigung und Helligkeit",
  saturation: "Sättigung",
  brightness: "Helligkeit",
  hue: "Farbton",
  alpha: "Deckkraft",
  value: "Farbwert",
  format: "Format",
  eyedropper: "Vom Bildschirm aufnehmen",
  copy: "Kopieren",
  copied: "Kopiert",
};

export function GermanPicker() {
  return <ColorPicker defaultColor="#245cdb" labels={labels} />;
}
