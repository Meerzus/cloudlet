# Changelog — cloudlet.dev

Changes to the website and to the shadcn registry items that have no npm package. Registry items are
installed as source, so they have no versions: a section is named after the day it reached
cloudlet.dev. The history of the npm package `@cloudlet/toast` is in the
[root CHANGELOG](../../CHANGELOG.md).

## 2026-11-15

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

### Color palette

- `npx shadcn@latest add https://cloudlet.dev/r/color-palette.json` adds `components/ui/color-palette/color-palette.tsx`
  and `color-palette.css`, and installs the color picker with it as a registry dependency.
- `ColorPalette` is a row of one to `max` colors (4 by default), each a `ColorPicker`. The add button
  appends the last color turned in OKLCH hue and opens its picker at once; a color is removed with
  Delete or Backspace, or the pointer's × on the swatch, down to one. Swatches grow in and fold away
  on springs, instantly under reduced motion or inside a `data-reduced-motion` ancestor.
- `colors`/`defaultColors` and `onChange` take and return an array of strings in `format`; the format
  switch in any picker changes every color. `name` adds one hidden input per color, `labels`
  translates the palette and, through `labels.picker`, its pickers.
- Keyboard and screen readers: the palette is a named group with one Tab stop; ← and → move between
  the swatches and the add button, Home and End jump to the ends. Each swatch is named "Color 2 of 3,
  #2f8f9d", and a removal is announced.
- About 3.5 KB min+gzip on top of the color picker (JS and CSS), measured by
  `npm run size:color-palette`.

### Website

- [cloudlet.dev](https://cloudlet.dev) is the kit's own page instead of a redirect to `/toaster`: the
  kit in one line, the `npx shadcn@latest add @cloudlet/<item>` command with a switch of the
  components, and every component with a link to its landing and its docs. The root has its own
  title, description and canonical address and is the first entry of `sitemap.xml`; the Toaster's
  title, description and link card moved to [/toaster](https://cloudlet.dev/toaster). The Color
  picker's page shares its card as a large image on X too.
- The top of [cloudlet.dev](https://cloudlet.dev) is painted: "Made to work together." on the color
  picker's grainy airbrushed paint, with the line "A Toaster, a color picker and a palette for React.
  Change one color and the whole kit answers.", the install command with a switch of the components,
  and two buttons under it — Browse components (the list in the docs) and Star on GitHub (the count
  shows from 100 stars). Beside the words are the kit's three components, live and at the same
  weight: the Toaster, whose record shows a success, an info, an error or an upload, and whose Send
  sends it into the page's Island (it flies out of the record; an upload turns into a success in
  place); the Color picker's panel, which sets the page color; and the Color palette, whose own colors
  paint the page. The paint spreads in from the picker on load, repaints from the control that changed
  it, and runs into the sky of the Toaster's chapter along a ragged airbrush edge. Once a change has
  settled the Island says "Accent updated" or "Palette updated", one notification updated in place;
  loading and scrolling say nothing. Reduced motion (the system's or the page's own switch) keeps the
  paint still, and without WebGL 2 a still frame of it stands in. On a phone the words, the command
  and the buttons come first, then the three components one under another.
- Under the first screen, on the sky, the Toaster's chapter: two identical phones, a plain stack of toasts
  on the left and the real Toaster on the right, and one row of buttons (Send one, Send three,
  Update, Take back) that sends the same notifications to both at the same moment. The plain stack
  fades them in and out and pushes the rest aside; Toaster stacks them and turns around halfway. The
  Toaster's phone is live (tap its stack to open it) and loads as the chapter comes near; on a phone
  the two stand one above the other. Then Open Toaster and its install command.
- Under the Toaster's chapter the sky runs into the color picker's paint and out of it again: the
  chapter of the Color picker and the Color palette is painted with the same grainy airbrushed frame
  as [/color-picker](https://cloudlet.dev/color-picker), in the page's one color (the hero's), with
  paper under its words and a ragged airbrush edge at its top and bottom. The paint loads as the
  chapter comes near and spreads in from the heading; it flows only while the chapter is on screen, the
  cursor stirs it, reduced motion keeps it still, and without WebGL 2 a still frame of it stands in.
  The hero and the chapter share one WebGL context, and the address of the kit's page does not change.
  The list of components that stood there is gone.
- In that chapter, "Same color. Better in hand.": two comparisons on identical sheets. The browser's
  own color input beside the Color picker, with a row of colors that sets both at once; a row of the
  browser's color inputs with a plus and a remove button beside the Color palette, with harmonies that
  fill both. Both sides hold the same color or palette, so a change on either shows on the other, and
  every change repaints the chapter: a press spreads out of the control, a drag repaints at once, and
  a palette of your own paints the whole page in its colors. Once a change has settled, the page's
  Island says "Accent updated" or "Palette updated" and keeps updating that one notification while it
  is on screen; loading and scrolling say nothing. Each comparison ends with Open Color picker or Open
  Color palette and its install command.
- Open Toaster, Open Color picker and Open Color palette on the kit's page open the landing out of the
  link itself: it grows from the link's pill to the whole window on a spring while the kit's page
  sinks back behind it, and the browser's Back shrinks it into the same link, with the kit's page
  where you left it. The header stays put. The color picker's landing opens in the chapter's colors
  (`?c=`), so its paint goes on where the chapter's was; a link off screen swaps the pages with a short
  blur. The header, its Components panel, the footers and the docs navigate as before, and with
  reduced motion or without view transitions every link is a plain navigation.
- Back on the sky under the color picker's chapter, Install: the `npx shadcn@latest add @cloudlet/<item>`
  command with a switch of the components, what the item adds, the same item by its address
  (`https://cloudlet.dev/r/<item>.json`) for a CLI that does not know the namespace, and the few lines
  that use it, which run on the page: edit the notification's title and Run (or press Enter) and it
  flies out of the `<Toaster />` line into the page's Island; the swatch after `<ColorPicker />` opens
  the real picker and the palette after `<ColorPalette />` is the real palette, with the code's values
  following them. Copy takes the code with your values. The page ends with Star on GitHub, large,
  and the install command once more.
- Between Install and Star on GitHub, Principles: four promises, each shown on the page. Motion — a
  picker to catch halfway, with slow motion at a quarter speed. Accessibility — a switch that reduces
  motion on this page (smooth scrolling, the sky's parallax, the scenes, the paint's spread and flow,
  the entrances and the transitions to a landing; the Color picker and the Color palette follow it,
  the Toaster follows the system setting), and the path Tab takes through a live picker. Your theme —
  three themes on the shadcn tokens for a picker and a palette, with the stylesheet they amount to and
  the Toaster's style editor. Tested, not promised — what the repository runs, each line with links to
  the files on GitHub. Then a short FAQ about the kit.
- The kit's page has a link card of its own on social sites and in chats: "Cloudlet" and "Made to
  work together" written in clouds across a starry night sky (it was the Toaster's). The docs
  pages share it on X as before, now with their own title and description there.
- At night the kit's clouds are dimmer and the words below the hero carry a soft halo of the night
  sky, so a moonlit cloud drifting behind a line no longer washes it out. The Paper and Terminal
  themes in Principles have darker text, so the picker's format switch reads at 4.5:1 in them too.
- [/color-picker](https://cloudlet.dev/color-picker): "pick a color, paint the page". One long grainy
  airbrushed paint lies under the whole page, recolored in one WebGL 2 shader by the picked color: the
  open panel beside the headline paints it, a new color bleeds out of the control that made it, and
  the paint drifts slowly (it stands still under reduced motion). A mouse or a trackpad stirs the paint
  like a liquid: it swirls behind the cursor in its own colors and settles back within a few seconds,
  and a click sets a swirl going; the paper under the text holds still, a click in Tools takes the
  color the stirred paint shows, and touch screens, reduced motion and a software WebGL keep it still. The theme picks the scene, the dark
  theme reading the paint the other way round; the paper lifts under every line of text, so the copy
  keeps the theme's colors at 4.5:1 or more, and the footer sits over a soft blur of the paint. Without
  WebGL 2 the page keeps a flat background of the color. The page keeps a palette of up to four colors
  whose first is the page color, and `?c=` keeps the palette in the address. Below the headline:
  - Palette: the color palette with harmonies (complement, split complement, analogous, tints) as
    hints that fill it; once the palette is yours, the whole page is painted in its colors;
  - Opacity: within the section the page's paint is as opaque as the alpha of an inline panel, with
    the value and a Copy button;
  - Tools: a click anywhere on the paint around the controls takes the color it shows there, or the
    arrows and Enter do, in every browser (worked out from the picture and the colors, not a
    screenshot); the compact picker and the same color in four formats, each copied by a click;
  - the inline panel with a keyboard cheat sheet and a reduce-motion switch, the two install commands
    and an example, and a FAQ.
- [/docs/components/color-picker](https://cloudlet.dev/docs/components/color-picker): install, use, every prop and label,
  formats and their exact output, eyedropper and copy, keyboard and screen readers, styling, placement
  limits and reduced motion, then the palette's install, use, props, keyboard and labels, each with a
  live example. It is also in `llms.txt`, `llms-full.txt`, as
  [Markdown](https://cloudlet.dev/docs/components/color-picker.md), in search and in the sitemap.
- The header's Components button opens a panel of the kit's components: Toaster, Color picker and
  Color palette, each with a line of description, the current one marked. The panel grows out of the
  button on springs and shrinks back into it, a second press mid-way turns it around, and under
  reduced motion it appears at once. It opens on a click or a tap; Tab and the arrow keys move through
  it, and Escape, a press outside, focus leaving it or a new page close it. The logo leads to the
  kit's own page, Docs to the current component's docs or to `/docs`, and the header no longer links
  to the Playground (the Toaster's landing does).
- Star on GitHub replaces the GitHub icon in the header: one button of two icons, the GitHub mark and
  a star, on every width. From 100 stars it shows the count beside them (`128`, `1.2k`), read from
  GitHub when the site is built; the browser never asks GitHub.
- On phones the theme switch is one button that cycles System, Light and Dark, and the header with
  the logo, Components, Docs, the theme and Star fits one line down to 320 px; a larger system font
  moves the right-hand buttons to a second line instead of off the screen.
- Both footers, the cloud bank of the Toaster's landing and the one-line footer of the docs and the
  Color picker's page, carry the same row of links: Cloudlet (the kit's page), Toaster, Color picker,
  Color palette, Docs, GitHub and the MIT License. On phones the row wraps without separating dots,
  and every link is at least 24 px tall.
- `/color-picker` and its docs share a link card made from the top of the page.
- The style editor on [/docs/components/toaster/styling](https://cloudlet.dev/docs/components/toaster/styling) uses the
  color picker in hex, and the site no longer depends on `react-colorful`.

### Documentation

- The documentation is one tree for the whole kit at [/docs](https://cloudlet.dev/docs), with one
  sidebar: Getting started, Components, then the Toaster's own pages. The Toaster's pages moved to
  `/docs/components/toaster/…` with their slugs, the Color picker's page to
  `/docs/components/color-picker`.
- Two new pages open the tree. [Introduction](https://cloudlet.dev/docs) says what Cloudlet is, how
  engines (npm packages) differ from simple components (source through the shadcn registry) and which
  components there are. [Installation](https://cloudlet.dev/docs/installation) adds any item as
  `@cloudlet/<item>` or by its URL and installs an engine from npm, with every command in your
  package manager.
- The former addresses (`/toaster/docs/…`, `/color-picker/docs` and their `.md` pages) redirect
  permanently to the new ones. Search, `llms.txt`, `llms-full.txt`, the `.md` pages and the sitemap
  follow the new sidebar; `llms.txt` opens with a line about the kit.
- The READMEs, the security policy and the issue template link to the new addresses.
- On the kit's own pages (Introduction, Installation) Docs in the header leads to the kit's
  Introduction instead of the Toaster's page.

### Fixes

- Documentation pages keep the link card of their section (Toaster and Color picker); they had none.
- The cloud icon keeps its cut-outs in dark mode where the page sets a fill on SVGs, as the shadcn
  directory does.
- At 320 px [/toaster](https://cloudlet.dev/toaster) no longer scrolls sideways by a pixel: the
  install command fits the screen whole.
- In Tools on [/color-picker](https://cloudlet.dev/color-picker), a click on the paint takes the
  color under the cursor in windows wider than the paint's frame too; there it read the frame shrunk
  into the window's left part.
