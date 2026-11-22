"use client";

import { useState, type CSSProperties } from "react";
import { ColorPicker } from "@/components/ui/color-picker/color-picker";

export function AccentVariable() {
  const [accent, setAccent] = useState("#245cdb");
  return (
    <div style={{ "--accent": accent } as CSSProperties}>
      <ColorPicker color={accent} onChange={setAccent} swatch="var(--accent)" labels={{ open: "Pick accent" }} />
    </div>
  );
}
