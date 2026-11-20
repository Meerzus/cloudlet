"use client";

import { useState } from "react";
import { ColorPickerPanel } from "@/components/ui/color-picker/color-picker";

export function InlinePanel() {
  const [color, setColor] = useState("#245cdb");
  return <ColorPickerPanel color={color} onChange={setColor} labels={{ value: "Accent color" }} />;
}
