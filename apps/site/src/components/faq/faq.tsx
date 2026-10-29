import { FAQ } from '@/lib/faq';
import { FaqItem } from './faq-item';

/** Native disclosure widgets: keyboard, screen readers and find-in-page work without script; FaqItem animates clicks. */
export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="relative px-4 sm:px-6">
      <div className="mx-auto max-w-6xl py-24 sm:py-32">
        <h2 id="faq-title" className="text-balance text-4xl font-semibold tracking-[-0.03em] sm:text-6xl">
          Questions
        </h2>
        <p className="mt-4 max-w-2xl text-pretty text-lg text-muted-foreground sm:text-xl">
          Short answers about SSR, styling, accessibility and size.
        </p>
        <div className="faq-list">
          {FAQ.map((item) => (
            <FaqItem key={item.id} question={item.question} answer={item.answer} />
          ))}
        </div>
      </div>
    </section>
  );
}
