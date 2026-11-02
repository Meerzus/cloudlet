# Changelog — cloudlet.dev

Changes to the website and to the shadcn registry items that have no npm package. Registry items are
installed as source, so they have no versions: a section is named after the day it reached
cloudlet.dev. The history of the npm package `@cloudlet/toast` is in the
[root CHANGELOG](../../CHANGELOG.md).

## Unreleased

The Color picker, Cloudlet's second component. It is a shadcn registry item with no dependencies
besides React: the CLI copies its source into your project, and there is no npm package to update.
Nothing changes for `@cloudlet/toast` or the `toaster` item.

### Color picker

- `npx shadcn@latest add https://cloudlet.dev/r/color-picker.json` adds five files:
  `components/ui/color-picker/color-picker.tsx`, `color-picker.css`, `color.ts`, `morph.ts` and
  `lib/spring.ts`. The component imports its own stylesheet, reads the shadcn tokens `--background`,
  `--foreground`, `--border`, `--ring` and `--muted`, and does not rely on Tailwind's preflight.
- `ColorPicker` is a round swatch that morphs into the panel on interruptible springs and back into
  the circle when it closes. `ColorPickerPanel` renders the same panel inline.
- The panel has a saturation × brightness area, a hue slider, an optional opacity slider (`alpha`),
  an editable value, a switch between hex, rgb, hsl and oklch, the eyedropper where the browser has
  one, and copy. `color`/`defaultColor` and `onChange` take and return strings in any of the four
  syntaxes; `format`/`defaultFormat`/`onFormatChange` and `formats` control the output, `name` adds
  a hidden input for forms, `labels` translates every text.
- The panel flips up or left when it would cross the edge of the viewport. It is not portalled: an
  ancestor with `overflow: hidden` clips it.
- Keyboard and screen readers: arrows move the area and the sliders (Shift for bigger steps), Home
  and End jump to the ends of a slider, and they announce "Saturation 40%, Brightness 80%",
  "Hue 48°" and "Opacity 50%". Escape, or Tab out of the panel, closes it; copying is spoken. Under `prefers-reduced-motion: reduce`, or inside any element with
  `data-reduced-motion`, it opens without the morph.
- About 9 KB min+gzip with React external (JS and CSS), measured by `npm run size:color-picker`.

### Website

- [/color-picker](https://cloudlet.dev/color-picker): a landscape painted in one WebGL 2 shader whose
  sun is the picker's swatch — the lightness of the picked color sets the time of day, and `?c=` keeps
  the color in the address. Below it: combinations of the picked color in OKLCH with three printed
  posters, the inline panel with a keyboard cheat sheet and a reduce-motion switch, the install
  command and an example, and a FAQ.
- [/color-picker/docs](https://cloudlet.dev/color-picker/docs): install, use, every prop and label,
  formats and their exact output, eyedropper and copy, keyboard and screen readers, styling, placement
  limits and reduced motion, with a live example. It is also in `llms.txt`, `llms-full.txt`, as
  [Markdown](https://cloudlet.dev/color-picker/docs.md), in search and in the sitemap.
- The header switches between Toaster and Color picker; its logo and Docs link follow the current
  component.
- `/color-picker` and its docs share a link card made from the hero.
- The style editor on [/toaster/docs/styling](https://cloudlet.dev/toaster/docs/styling) uses the
  color picker in hex, and the site no longer depends on `react-colorful`.

### Fixes

- Documentation pages keep the link card of their section (Toaster and Color picker); they had none.
- The cloud icon keeps its cut-outs in dark mode where the page sets a fill on SVGs, as the shadcn
  directory does.
