"use client";

import { useState } from "react";
import { ColorPickerPanel, type ColorFormat } from "@/components/ui/color-picker/color-picker";

export function SavedFormat() {
  const [color, setColor] = useState("oklch(51.9% 0.203 263.2)");
  const [format, setFormat] = useState<ColorFormat>("oklch");
  return (
    <div className="grid justify-items-center gap-3">
      <ColorPickerPanel color={color} onChange={setColor} format={format} onFormatChange={setFormat} />
      <p className="text-sm">Saved format: {format}</p>
    </div>
  );
}
