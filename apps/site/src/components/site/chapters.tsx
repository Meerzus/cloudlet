'use client';

import { useEffect, useRef, useState } from 'react';
import { useMotion } from './motion';

/** The landing's chapters, in page order: the section id and the label shown on hover and focus. */
const CHAPTERS = [
  { id: 'hero', label: 'Intro' },
  { id: 'life', label: 'Life of a notification' },
  { id: 'drifting', label: 'Drifting by' },
  { id: 'get-started', label: 'Get started' },
  { id: 'faq', label: 'FAQ' },
] as const;

/** A chapter counts as reached when its start is this far into the viewport. */
const REACHED = 0.3;
/** The dots hide as the footer wordmark arrives, when its top is this far up the viewport. */
const HIDE_BEFORE_FOOTER = 0.5;

/**
 * Where the reader is on the landing, on the right edge: one dot per chapter. The current chapter's
 * dot morphs into a pill that fills as the chapter scrolls by, the way the stack morphs into the
 * Island. A dot jumps to its chapter: through Lenis when it runs, instantly under reduced motion.
 * Wide screens only (CSS: from 80rem the content column leaves a margin); visible from the first
 * screen, hidden under the footer wordmark like the header.
 */
export function Chapters() {
  const { lenis, reduced } = useMotion();
  const fills = useRef<(HTMLSpanElement | null)[]>([]);
  const starts = useRef<number[]>([]);
  const [active, setActive] = useState(0);
  const [shown, setShown] = useState(true);

  useEffect(() => {
    const header = () => document.querySelector<HTMLElement>('.site-header')?.offsetHeight ?? 0;
    /** Where each chapter starts: the top of a pinned scene's spacer, or the section under the header. */
    const measure = () => {
      starts.current = CHAPTERS.map(({ id }, index) => {
        const section = document.getElementById(id);
        if (!section || index === 0) return 0;
        const spacer = section.querySelector<HTMLElement>('.pin-spacer');
        const top = (spacer ?? section).getBoundingClientRect().top + window.scrollY;
        return Math.max(0, Math.round(spacer ? top : top - header()));
      });
      update();
    };
    const update = () => {
      const y = window.scrollY;
      const reach = y + window.innerHeight * REACHED;
      const list = starts.current;
      let current = 0;
      for (let index = 0; index < list.length; index += 1) if (list[index]! <= reach) current = index;
      const end = current + 1 < list.length ? list[current + 1]! : document.documentElement.scrollHeight - window.innerHeight;
      // The first chapter fills from the very top of the page.
      const from = current === 0 ? 0 : list[current]! - window.innerHeight * REACHED;
      const progress = Math.min(1, Math.max(0, (y - from) / Math.max(1, end - window.innerHeight * REACHED - from)));
      fills.current.forEach((fill, index) => {
        if (fill) fill.style.transform = `scaleY(${index < current ? 1 : index === current ? progress : 0})`;
      });
      setActive(current);
      const footer = document.querySelector<HTMLElement>('.site-footer');
      const footerTop = footer ? footer.getBoundingClientRect().top : Infinity;
      setShown(footerTop > window.innerHeight * HIDE_BEFORE_FOOTER);
    };

    measure();
    // Pinned scenes add their spacers after the motion runtime loads: remeasure whenever the page resizes.
    const observer = new ResizeObserver(measure);
    const main = document.querySelector('main');
    if (main) observer.observe(main);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', update, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', update);
    };
  }, []);

  const jump = (index: number) => {
    const top = starts.current[index] ?? 0;
    if (lenis && !reduced) lenis.scrollTo(top, { duration: 1.2 });
    else window.scrollTo({ top, behavior: 'instant' });
  };

  return (
    <nav aria-label="Sections" className="chapters" data-shown={shown} inert={!shown}>
      <ol>
        {CHAPTERS.map(({ id, label }, index) => (
          <li key={id}>
            <button
              type="button"
              className="chapter"
              aria-label={label}
              aria-current={index === active ? 'location' : undefined}
              onClick={() => jump(index)}
            >
              <span className="chapter-dot" aria-hidden="true">
                <span className="chapter-fill" ref={(element) => void (fills.current[index] = element)} />
              </span>
              <span className="chapter-label" aria-hidden="true">
                {label}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
