import { ColorPicker, type ColorPickerLabels } from "@/components/ui/color-picker/color-picker";

const labels: ColorPickerLabels = {
  open: "Elegir color",
  panel: "Selector de color",
  close: "Cerrar",
  area: "Saturación y brillo",
  saturation: "Saturación",
  brightness: "Brillo",
  hue: "Tono",
  alpha: "Opacidad",
  value: "Valor del color",
  format: "Formato",
  eyedropper: "Tomar de la pantalla",
  copy: "Copiar",
  copied: "Copiado",
};

export function SpanishPicker() {
  return <ColorPicker defaultColor="#245cdb" labels={labels} />;
}
