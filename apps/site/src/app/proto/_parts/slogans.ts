/** A headline and the line under it, as one hero would print them. */
export interface Slogan {
  readonly title: string;
  readonly lede: string;
}

export type ProtoId = 'a' | 'b' | 'c';

/** The prototypes in the order the comparison page shows them. */
export const PROTOTYPES: readonly { readonly id: ProtoId; readonly name: string; readonly idea: string }[] = [
  { id: 'a', name: 'Kit at work', idea: 'A small live interface: the palette and the picker set a color, the page repaints, the Island reports it.' },
  { id: 'b', name: 'Sky', idea: 'The Toaster sky across the whole screen, Cloudlet written in clouds, the components resting on clouds.' },
  { id: 'c', name: 'Code comes alive', idea: 'The first screen is code: the install command and a few lines of JSX that run in place.' },
];

/** Two or three slogans per prototype; `?s=1|2|3` picks one. */
export const SLOGANS: Readonly<Record<ProtoId, readonly Slogan[]>> = {
  a: [
    {
      title: 'Made to work together.',
      lede: 'A Toaster, a color picker and a palette for React. Change one color and the whole kit answers.',
    },
    {
      title: 'Pick a color. The kit answers.',
      lede: 'The picker sets it, the palette builds on it, the page repaints and a toast confirms. All of it real.',
    },
    {
      title: 'Small parts, one living interface.',
      lede: 'React components on springs, installed with shadcn. Every one on this screen is the one you get.',
    },
  ],
  b: [
    {
      title: 'Light as a cloud.',
      lede: 'React components that move as if they weigh nothing. Install them with shadcn and own every line.',
    },
    {
      title: 'Everything floats. Nothing jumps.',
      lede: 'A small kit of React components on springs: a Toaster, a color picker and a palette.',
    },
    {
      title: 'Calm components for React.',
      lede: 'Springs instead of timers, motion you can catch halfway, and a keyboard path through every control.',
    },
  ],
  c: [
    {
      title: 'This is all you write.',
      lede: 'One command, a few lines of JSX. Run them here: this is the code you ship.',
    },
    {
      title: 'Copy the line. Ship the motion.',
      lede: 'shadcn puts the source in your app. Springs, focus and screen reader support come with it.',
    },
    {
      title: 'Plain JSX. Living components.',
      lede: 'Edit a prop, press Run. What happens here is what happens in your app.',
    },
  ],
};
