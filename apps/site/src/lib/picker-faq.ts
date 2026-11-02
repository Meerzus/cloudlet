/** The color picker landing's FAQ (COLOR_PICKER §8.5): draft copy for the owner's review. */
export const PICKER_FAQ = [
  {
    id: 'registry',
    question: 'Why a shadcn item and not an npm package?',
    answer:
      'A color picker is something you end up restyling. The shadcn CLI copies its source into your project, so the markup, the CSS and the labels are yours to change, with nothing to keep upgrading.',
  },
  {
    id: 'oklch',
    question: 'What happens to oklch() colors outside sRGB?',
    answer:
      'The swatch shows them as given. The area is sRGB, so the first move of a handle keeps the lightness and hue and lowers the chroma until the color fits; the output is always one of the four formats you allow.',
  },
  {
    id: 'eyedropper',
    question: 'Where is the eyedropper in Safari and Firefox?',
    answer:
      'It appears only where the browser has the EyeDropper API (Chromium browsers today). Elsewhere the button is not rendered at all, rather than shown disabled.',
  },
  {
    id: 'overflow',
    question: 'Why is the panel cut off inside my card?',
    answer:
      'The panel is not portalled, so it keeps your theme and works inside iframes, but a container with overflow: hidden clips it. Give that container overflow: visible, or place the picker outside it. Near the viewport edges the panel flips up or left on its own.',
  },
  {
    id: 'labels',
    question: 'How do I translate it or name it for screen readers?',
    answer:
      'Pass labels: every string the picker says or announces is there, from the swatch button to “Copied”. Anything you leave out keeps its English default.',
  },
] as const;
