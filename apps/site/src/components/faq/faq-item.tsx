'use client';

import { ChevronDown } from 'lucide-react';
import { useRef, type MouseEvent } from 'react';
import { useMotion } from '@/components/site/motion';
import { springEasing } from '@/lib/spring';

/** Opening: a critically damped spring (no overshoot), 95% of the way in about 280 ms. */
const OPEN = springEasing({ stiffness: 300, damping: 35 });
/** Closing is quicker and plain ease-out. */
const CLOSE = { easing: 'cubic-bezier(0.23, 1, 0.32, 1)', duration: 200 } as const;
/** The answer settles down from this offset as it fades in. */
const SHIFT = '0 -4px';

interface Running {
  readonly opening: boolean;
  readonly height: Animation;
  readonly answer: Animation;
}

/**
 * A native `<details>` whose click is animated: the height springs open, the answer fades in with a
 * small drop, and a click mid-way reverses from wherever the item is. Find-in-page and reduced
 * motion toggle it natively, without animation. The chevron turns by CSS on the same timing.
 */
export function FaqItem({ question, answer }: { question: string; answer: string }) {
  const itemRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const running = useRef<Running | null>(null);
  const { reduced } = useMotion();

  const toggle = (event: MouseEvent<HTMLElement>) => {
    const item = itemRef.current;
    const summary = summaryRef.current;
    const body = answerRef.current;
    if (reduced || !item || !summary || !body) return;
    event.preventDefault();

    const current = running.current;
    const opening = current ? !current.opening : !item.open;
    const fromHeight = item.getBoundingClientRect().height;
    const style = getComputedStyle(body);
    const from = current
      ? { opacity: style.opacity, translate: style.translate === 'none' ? '0 0' : style.translate }
      : opening
        ? { opacity: '0', translate: SHIFT }
        : { opacity: '1', translate: '0 0' };
    current?.height.cancel();
    current?.answer.cancel();

    item.open = true;
    const edge = item.offsetHeight - item.clientHeight;
    const toHeight = opening ? item.getBoundingClientRect().height : summary.getBoundingClientRect().height + edge;

    const timing = opening ? OPEN : CLOSE;
    item.dataset.state = opening ? 'opening' : 'closing';
    item.style.setProperty('--faq-chevron-duration', `${timing.duration}ms`);
    item.style.setProperty('--faq-chevron-easing', timing.easing);
    item.style.overflow = 'hidden';

    const options = { duration: timing.duration, easing: timing.easing };
    const height = item.animate({ height: [`${fromHeight}px`, `${toHeight}px`] }, options);
    const fade = body.animate(
      { opacity: [from.opacity, opening ? '1' : '0'], translate: [from.translate, opening ? '0 0' : SHIFT] },
      options,
    );
    running.current = { opening, height, answer: fade };
    height.onfinish = () => {
      running.current = null;
      if (!opening) item.open = false;
      delete item.dataset.state;
      item.style.overflow = '';
    };
  };

  return (
    <details ref={itemRef} className="faq-item">
      <summary ref={summaryRef} onClick={toggle}>
        <span className="faq-question">{question}</span>
        <ChevronDown className="faq-chevron" aria-hidden="true" />
      </summary>
      <div ref={answerRef} className="faq-answer">
        <p>{answer}</p>
      </div>
    </details>
  );
}
