"use client";

import { useState } from "react";
import { ColorPalette } from "@/components/ui/color-palette/color-palette";

export function BrandForm() {
  const [sent, setSent] = useState<string[]>([]);
  return (
    <form className="grid justify-items-center gap-3" action={(data) => setSent(data.getAll("brand").map(String))}>
      <ColorPalette defaultColors={["#245cdb", "#f2b84b"]} max={3} name="brand" labels={{ group: "Brand colors" }} />
      <button type="submit" className="rounded-md border px-3 py-1.5 text-sm">
        Save
      </button>
      <output className="text-sm">{sent.join(", ")}</output>
    </form>
  );
}
