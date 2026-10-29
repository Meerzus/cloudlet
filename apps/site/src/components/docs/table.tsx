'use client';

import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { DOCS_UI } from '@/lib/docs-ui-strings';

/**
 * A Markdown table in a wrapper that scrolls sideways on narrow screens. Only a table
 * wider than its column becomes a focusable region, so keyboard users can scroll it (axe
 * `scrollable-region-focusable`) and narrow tables add no tab stop. The region is named by its
 * column headers, which keeps two tables of one page apart.
 */
export function Table(props: ComponentProps<'table'>) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    const columns = [...element.querySelectorAll('thead th')].map((cell) => cell.textContent?.trim()).filter(Boolean).join(', ');
    const measure = () => setLabel(element.scrollWidth > element.clientWidth ? `${DOCS_UI.scrollableTable}: ${columns}` : null);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={wrapper}
      className="docs-table"
      {...(label ? { tabIndex: 0, role: 'region', 'aria-label': label } : {})}
    >
      <table {...props} />
    </div>
  );
}
