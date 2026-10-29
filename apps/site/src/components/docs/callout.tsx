import { Info, Lightbulb, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { DOCS_UI } from '@/lib/docs-ui-strings';

export type CalloutType = 'note' | 'tip' | 'warning';

const ICONS: Record<CalloutType, typeof Info> = { note: Info, tip: Lightbulb, warning: TriangleAlert };

/** Three kinds of aside: note, tip, warning. `title` defaults to the kind's label. */
export function Callout({ type = 'note', title, children }: { type?: CalloutType; title?: ReactNode; children: ReactNode }) {
  const Icon = ICONS[type];
  return (
    <aside className="docs-callout" data-type={type}>
      <Icon className="docs-callout-icon" aria-hidden="true" />
      <div className="docs-callout-body">
        <p className="docs-callout-title">{title ?? DOCS_UI.noteLabels[type]}</p>
        <div className="docs-callout-content">{children}</div>
      </div>
    </aside>
  );
}
