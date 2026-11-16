import type { ReactCloudletController } from '@cloudlet/toast';

/**
 * The page's Island answering the color picker's chapter on the kit's landing: once a color the
 * visitor set has rested for a moment, one notification says what changed, and while it is on screen
 * every later change updates it in place instead of stacking another one. Nothing here knows about
 * React: the chapter notes each of the visitor's changes, the report reads the state when it fires.
 */

/** How long a color must rest after the visitor's last change before the Island reports it: a drag reports once, when it stops. */
export const SETTLE = 450;

/** What the visitor changed: the page color (the picker) or the palette. */
export type ColorChangeKind = 'accent' | 'palette';

/** The chapter's colors when the report fires. */
export interface ColorReportState {
  /** The page color, `#rrggbb`. */
  readonly hex: string;
  /** How many colors the palette holds. */
  readonly count: number;
}

export type ReportController = Pick<ReactCloudletController, 'show' | 'update' | 'getHandle'>;

/** The notification's words for a change. */
export function reportText(kind: ColorChangeKind, state: ColorReportState): { readonly title: string; readonly text: string } {
  if (kind === 'accent') return { title: 'Accent updated', text: `The chapter now paints in ${state.hex.toUpperCase()}.` };
  return { title: 'Palette updated', text: `${state.count} ${state.count === 1 ? 'color' : 'colors'} across the paint, the darkest in the shadows.` };
}

export interface ColorReport {
  /** The visitor changed something: the report fires SETTLE ms after the last note, with the kind of the last one. */
  readonly note: (kind: ColorChangeKind) => void;
  /** Drops a report that has not fired yet. */
  readonly cancel: () => void;
}

export interface ColorReportOptions {
  /** The page's controller, or null before it exists (then a due report is dropped). */
  readonly controller: () => ReportController | null;
  /** The chapter's colors at the moment the report fires. */
  readonly read: () => ColorReportState;
  /** Prefix of the notification's id; a new id only once the last notification has left. */
  readonly id?: string;
  readonly settle?: number;
}

export function createColorReport({ controller, read, id: prefix = 'kit-color', settle = SETTLE }: ColorReportOptions): ColorReport {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: ColorChangeKind | null = null;
  let shown: string | null = null;
  let runs = 0;

  const fire = () => {
    timer = undefined;
    const target = controller();
    const kind = pending;
    pending = null;
    if (!target || !kind) return;
    const { title, text } = reportText(kind, read());
    const description = { kind: 'text', text } as const;
    // Still on screen: the same notification takes the new words.
    const handle = shown === null ? undefined : target.getHandle(shown);
    if (handle) {
      const { status } = target.update(handle, { title, description });
      if (status === 'applied' || status === 'unchanged') return;
    }
    runs += 1;
    shown = `${prefix}-${runs}`;
    target.show({ id: shown, title, kind: 'success', description });
  };

  return {
    note(kind) {
      pending = kind;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(fire, settle);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = null;
    },
  };
}
