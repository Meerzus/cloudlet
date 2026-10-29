import type { ReactCloudletController, ToasterProps } from '@cloudlet/toast';

/** Model state every QA fixture exposes the same way (public snapshot only). */
export interface IslandState {
  /** `stack` or `island`, as on the host's `data-state`. */
  readonly state: 'stack' | 'island';
  readonly reason: 'user' | 'attention' | null;
  /** ID of the presented record: the top pill in the stack, the current slide in the Island. */
  readonly current: string | null;
  /** Stack order, newest first. */
  readonly stack: readonly string[];
  /** Whether the presented record has been confirmed readable (presentation ack). */
  readonly readable: boolean;
  readonly missed: number;
}

export function islandState(controller: ReactCloudletController): IslandState {
  const snapshot = controller.getSnapshot();
  const current = snapshot.notifications.find(item => item.location === 'current');
  return {
    state: snapshot.island.open ? 'island' : 'stack',
    reason: snapshot.island.reason,
    current: current?.handle.id ?? null,
    stack: snapshot.stack.map(handle => handle.id),
    readable: current ? !current.pauseReasons.includes('presentation-pending') : false,
    missed: snapshot.overflow.pending ? snapshot.overflow.count : 0,
  };
}

export const pick = <T extends string>(value: string | null, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? value as T : fallback;

/** Common query parameters of the scenario fixtures. */
export function toasterQuery(params: URLSearchParams): { theme: NonNullable<ToasterProps['theme']>; dir: 'ltr' | 'rtl'; position: NonNullable<ToasterProps['position']>; timeScale: number } {
  const scale = Number(params.get('timeScale') ?? '1');
  return {
    theme: pick(params.get('theme'), ['system', 'light', 'dark'] as const, 'light'),
    dir: pick(params.get('dir'), ['ltr', 'rtl'] as const, 'ltr'),
    position: pick(params.get('position'), ['auto', 'top-center', 'bottom-center'] as const, 'top-center'),
    timeScale: Number.isFinite(scale) && scale > 0 ? scale : 1,
  };
}

export const fixtureLabels: NonNullable<ToasterProps['labels']> = {
  region: 'Notifications', island: 'Current notifications', carousel: 'carousel', slide: 'slide', close: 'Close notification', collapse: 'Escape to collapse',
  retry: 'Retry', cancel: 'Request cancellation', cancellationRequested: 'Cancellation requested', acknowledgeOverflow: 'Acknowledge missed',
  stackSummary: (title, count, missed) => [title, ...(count > 1 ? [`notifications: ${count}`] : []), ...(missed ? [`missed: ${missed}`] : [])].join(', '),
  page: (index, total) => `${index} of ${total}`,
  overflowCount: count => `Missed: ${count}`,
};

export const nonce = () => document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content;
