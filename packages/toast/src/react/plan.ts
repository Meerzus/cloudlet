import type { ReactNode } from 'react';
import type { NotificationHandle } from '../contracts/identity.js';
import type { RendererSnapshot } from '../contracts/internal.js';
import type { NotificationSnapshot } from '../contracts/snapshots.js';

type Presented = NotificationSnapshot<ReactNode>;

/** What the shell shows for one renderer snapshot. */
export interface ShellView {
  readonly presented: Presented | null;
  readonly open: boolean;
  readonly stack: readonly NotificationHandle[];
  readonly index: number;
  readonly total: number;
  /** Tails behind the collapsed pill (0–2); none in the Island. */
  readonly depth: number;
  /** Missed notifications (overflow), part of the badge and the pill name. */
  readonly missed: number;
  /** Badge number: records in the stack plus missed ones; shown on the pill at ≥ 2 or with missed ones. */
  readonly count: number;
  readonly badge: boolean;
}

export function shellView(snapshot: RendererSnapshot<ReactNode>): ShellView {
  const presented = snapshot.notifications.find(item => item.location === 'current') ?? null;
  const open = snapshot.island.open && presented !== null;
  const total = snapshot.stack.length;
  const missed = snapshot.overflow.pending ? snapshot.overflow.count : 0;
  return { presented, open, stack: snapshot.stack, total, index: presented ? snapshot.stack.indexOf(presented.handle) : -1,
    depth: open || !presented ? 0 : Math.min(2, Math.max(0, total - 1)),
    missed, count: total + missed, badge: !open && !!presented && (total > 1 || missed > 0) };
}

/** The collapsed view before the first commit. */
export const emptyView: ShellView = { presented: null, open: false, stack: [], index: -1, total: 0, depth: 0, missed: 0, count: 0, badge: false };

/** Visual transition between two committed views; pure, so it is unit-tested without DOM. */
export interface ShellPlan {
  /**
   * enter: from the edge; exit: the shell leaves (last record); arrival: a new top
   * pill enters while the old one becomes the first tail; rise: the top pill leaves
   * and the first tail moves up; replace: the old pill leaves and a new one enters.
   */
  readonly presence: 'none' | 'enter' | 'exit' | 'arrival' | 'rise' | 'replace';
  readonly morph: 'none' | 'open' | 'close';
  /** +1: the incoming slide comes from the inline end (towards older records). */
  readonly slide: 0 | 1 | -1;
  readonly header: boolean;
  readonly body: boolean;
  readonly badge: boolean;
  readonly page: boolean;
  /** Same record, new message: hide it from the scheduler until the swap is readable. */
  readonly begin: boolean;
  readonly tails: 'none' | 'arrival' | 'rise' | 'settle';
}

const headerKey = (item: Presented) => `${item.kind}\u0000${item.content.title}`;
function bodyKey(item: Presented) {
  const { content, operation, action } = item;
  const description = content.description;
  return [description?.kind, description?.kind === 'text' ? description.text : '', content.progress?.kind,
    content.action?.kind, content.action?.label, content.action?.kind === 'form' ? content.action.fields.map(field => field.name).join('\u0001') : '',
    action.status === 'failed' ? action.message : '',
    operation?.status, operation?.canRetry, operation?.canCancel].join('\u0000');
}

export function planShell(previous: ShellView, next: ShellView): ShellPlan {
  const plan = { presence: 'none', morph: 'none', slide: 0, header: false, body: false, badge: false, page: false,
    begin: false, tails: 'none' } as { -readonly [Key in keyof ShellPlan]: ShellPlan[Key] };
  const before = previous.presented;
  const after = next.presented;
  if (!after) {
    if (before) plan.presence = 'exit';
    return plan;
  }
  if (!before) {
    plan.presence = 'enter';
    return plan;
  }
  if (previous.open !== next.open) plan.morph = next.open ? 'open' : 'close';
  if (before.handle !== after.handle) {
    if (previous.open && next.open) {
      // Only the body slides: the title and icon blur-swap in place.
      plan.slide = next.index >= previous.index ? 1 : -1;
      plan.header = headerKey(before) !== headerKey(after) || before.content.icon !== after.content.icon;
    }
    else if (plan.morph !== 'none') plan.header = true;
    else if (next.stack.includes(before.handle)) { plan.presence = 'arrival'; plan.tails = 'arrival'; plan.header = true; }
    else if (previous.stack.includes(after.handle)) { plan.presence = 'rise'; plan.tails = 'rise'; }
    else plan.presence = 'replace';
  } else {
    plan.header = headerKey(before) !== headerKey(after) || before.content.icon !== after.content.icon;
    plan.body = previous.open && next.open && (bodyKey(before) !== bodyKey(after)
      || (before.content.description?.kind === 'rich' && after.content.description?.kind === 'rich'
        && before.content.description.content !== after.content.description.content));
    plan.begin = before.kind !== after.kind || before.operation?.status !== after.operation?.status;
  }
  if (plan.tails === 'none' && plan.morph === 'none' && !next.open && previous.depth !== next.depth) plan.tails = 'settle';
  plan.badge = previous.badge && next.badge && previous.count !== next.count;
  plan.page = previous.open && next.open && next.total > 5 && (previous.index !== next.index || previous.total !== next.total);
  return plan;
}
