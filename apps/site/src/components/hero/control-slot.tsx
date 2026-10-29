'use client';

import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { springEasing } from '@/lib/spring';
import { cn } from '@/lib/utils';

/** The slot grows and shrinks on this spring, so the row eases aside instead of jumping. */
const SLOT_SPRING = springEasing({ stiffness: 320, damping: 26 });

const SLOT_STYLE = {
  '--slot-ease': SLOT_SPRING.easing,
  '--slot-duration': `${SLOT_SPRING.duration}ms`,
} as CSSProperties;

/**
 * A control that comes and goes in the hero's row (Fold / Unfold). It stays mounted: hidden,
 * its slot is collapsed to zero width, and showing it springs the slot open to the control's
 * measured width, so the rest of the row eases aside. Label changes spring the same way.
 * `inert` defaults to `!shown`, so a hidden control is out of the tab order.
 */
export function ControlSlot({
  shown,
  inert = !shown,
  className,
  children,
}: {
  shown: boolean;
  inert?: boolean;
  className?: string;
  /** One control: its width is measured. */
  children: ReactNode;
}) {
  const slot = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = slot.current;
    const target = root?.firstElementChild as HTMLElement | null;
    if (!root || !target) return;
    const measure = () => root.style.setProperty('--slot-width', `${target.offsetWidth}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={slot} className={cn('control-slot', className)} data-shown={shown ? '' : undefined} style={SLOT_STYLE} inert={inert}>
      {children}
    </div>
  );
}
