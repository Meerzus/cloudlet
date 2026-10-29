import { formatKB, PACKAGE_SIZE } from './site';

/** FAQ (LANDING §9): draft copy for the owner's review. Size figures: `PACKAGE_SIZE`, min+gzip. */
export const FAQ = [
  {
    id: 'sonner',
    question: 'How is it different from Sonner?',
    answer:
      'Sonner is a lovely stack of toasts; Cloudlet is one stack that opens into an Island, with promises, retry and cancel built in, and every motion on interruptible springs.',
  },
  {
    id: 'ssr',
    question: 'Does it work with Next.js and SSR?',
    answer:
      'Yes. The server output and the first hydration render are empty, so nothing mismatches. Create the controller in a client component, import the CSS in your root layout, and anything shown before mount appears once the page hydrates.',
  },
  {
    id: 'styling',
    question: 'Can it look like my app?',
    answer:
      'Yes, without Tailwind or shadcn: override the scoped --cloudlet-* tokens for colours, radii and sizes, add your own classes to any part through classNames, and pick light, dark or system. The optional shadcn item maps your theme tokens for you.',
  },
  {
    id: 'a11y',
    question: 'Is it accessible?',
    answer:
      'The pill is a native button and the Island a labelled carousel. Arrivals never take focus, announcements are calm and coalesced, the keyboard reaches everything, and reduced motion and RTL are respected.',
  },
  {
    id: 'size',
    question: 'How big is it?',
    answer: `${formatKB(PACKAGE_SIZE.start)} of JavaScript on first load, min+gzip. The renderer (${formatKB(PACKAGE_SIZE.lazy)}) follows right after the page mounts, the CSS is ${formatKB(PACKAGE_SIZE.css)}. There are no runtime dependencies; the springs are its own.`,
  },
  {
    id: 'stable',
    question: 'Is it stable?',
    answer:
      'Yes: 1.0.0 is the stable release, and the API follows semantic versioning. Beyond the automated browser suite, screen readers, physical phones and the minimum browsers are checked by hand.',
  },
  {
    id: 'license',
    question: 'What does it cost?',
    answer: 'Nothing. Cloudlet is MIT-licensed: use it, change it, ship it.',
  },
] as const;
