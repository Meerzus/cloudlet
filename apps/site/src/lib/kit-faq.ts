import { COMPONENTS } from './site';

/** "A, B and C": the kit's components by name, so the answer grows with the kit. */
function names(): string {
  const all = COMPONENTS.map((component) => component.name);
  return all.length > 1 ? `${all.slice(0, -1).join(', ')} and ${all.at(-1)}` : (all[0] ?? '');
}

/** The kit landing's FAQ: copy for the owner's review, checked against the docs and the registry. */
export const KIT_FAQ: readonly { readonly id: string; readonly question: string; readonly answer: string }[] = [
  {
    id: 'what',
    question: 'What is Cloudlet?',
    answer: `A small kit of React components for the web: ${names()}. Each one moves on springs you can interrupt, works from the keyboard and with a screen reader, and is added with the shadcn CLI.`,
  },
  {
    id: 'shadcn-tailwind',
    question: 'Do I need shadcn/ui or Tailwind?',
    answer:
      'Not Tailwind: the styles are plain CSS that read the shadcn tokens, such as --background, --foreground, --border and --ring. The shadcn CLI is how the items arrive, and the Toaster also installs from npm without it.',
  },
  {
    id: 'npm-or-source',
    question: 'Why is the Toaster an npm package and the picker source code?',
    answer:
      'The Toaster is an engine: state, timers, animation and announcements live in @cloudlet/toast, so fixes come with an update, and its shadcn item adds a thin wrapper and a theme bridge. The Color picker and the Color palette are simple components: the CLI copies their files into your project, where they are yours to change.',
  },
  {
    id: 'next',
    question: 'Does it work with the Next.js App Router?',
    answer:
      'Yes. The components are client components, and every item is installed and used in a fresh Next.js app on each pull request. The Toaster renders nothing on the server, so it never mismatches; create its controller in a client component.',
  },
  {
    id: 'one',
    question: 'Can I take only one component?',
    answer:
      'Yes. Every item installs on its own; the palette brings the picker it is built on, and the Toaster brings @cloudlet/toast.',
  },
  {
    id: 'updates',
    question: 'How do I get updates?',
    answer:
      'For the Toaster, update the @cloudlet/toast package. The picker and the palette have no package and no version: add the item again and review the diff, keeping your own changes.',
  },
];
