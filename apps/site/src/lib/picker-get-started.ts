import { COLOR_PICKER_COMMAND } from './site';

/**
 * The color picker landing's Get started. The snippet is copied verbatim from registry/README.md,
 * which `npm run check:docs` typechecks against the picker's source; tests/unit/site-picker-landing.test.ts
 * fails when they drift apart.
 */
export const PICKER_GET_STARTED = {
  command: COLOR_PICKER_COMMAND,
  commandNote: 'The shadcn CLI copies five files into your project: the picker, its CSS, the color math, the morph and a small spring helper. No package is added.',
  file: 'accent-field.tsx',
  codeNote: 'Controlled like an input: give it any CSS color and take back a string in the format you chose.',
  code: `"use client";

import { useState } from "react";
import { ColorPicker } from "@/components/ui/color-picker/color-picker";

export function AccentField() {
  const [accent, setAccent] = useState("oklch(62% 0.19 255)");
  // The swatch opens the picker; \`name\` sends the value with a native form.
  return (
    <ColorPicker
      color={accent}
      onChange={setAccent}
      format="oklch"
      name="accent"
      labels={{ open: "Pick accent" }}
    />
  );
}`,
  source: 'registry/README.md',
} as const;
