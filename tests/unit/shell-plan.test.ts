import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { NotificationHandle, NotificationSnapshot } from '../../packages/toast/src/index.js';
import { planShell } from '../../packages/toast/src/react/plan.js';
import type { ShellView } from '../../packages/toast/src/react/plan.js';

type Item = NotificationSnapshot<ReactNode>;
const handles = new Map<string, NotificationHandle>();
const handle = (id: string) => handles.get(id) ?? handles.set(id, { id, generation: `${id}:1` } as unknown as NotificationHandle).get(id)!;
function item(id: string, patch: { title?: string; kind?: Item['kind']; text?: string; operation?: string } = {}): Item {
  return {
    handle: handle(id), kind: patch.kind ?? 'info', action: { status: 'idle' },
    content: { title: patch.title ?? id, ...(patch.text ? { description: { kind: 'text', text: patch.text } } : {}) },
    operation: patch.operation ? { status: patch.operation } : null,
  } as unknown as Item;
}
/** Stack ids are newest first; `current` is the presented id. */
function view(stack: string[], current: string | Item | null, open = false, missed = 0): ShellView {
  const presented = typeof current === 'string' ? item(current) : current;
  const handlesInStack = stack.map(handle);
  const opened = open && !!presented;
  return { presented, open: opened, stack: handlesInStack, total: stack.length,
    index: presented ? handlesInStack.indexOf(presented.handle) : -1,
    depth: opened || !presented ? 0 : Math.min(2, Math.max(0, stack.length - 1)),
    missed, count: stack.length + missed, badge: !opened && !!presented && (stack.length > 1 || missed > 0) };
}
const empty = view([], null);

describe('shell transition plan', () => {
  it('enters from the edge and exits after the last record', () => {
    expect(planShell(empty, view(['a'], 'a'))).toMatchObject({ presence: 'enter', morph: 'none', slide: 0 });
    expect(planShell(view(['a'], 'a', true), empty)).toMatchObject({ presence: 'exit' });
    expect(planShell(empty, empty)).toMatchObject({ presence: 'none', tails: 'none' });
  });

  it('pushes the old pill back as a tail on arrival and raises the first tail when the top leaves', () => {
    expect(planShell(view(['b', 'a'], 'b'), view(['c', 'b', 'a'], 'c'))).toMatchObject({ presence: 'arrival', tails: 'arrival', header: true });
    expect(planShell(view(['c', 'b', 'a'], 'c'), view(['b', 'a'], 'b'))).toMatchObject({ presence: 'rise', tails: 'rise' });
    // clear() + show(): nothing of the old stack survives.
    expect(planShell(view(['b', 'a'], 'b'), view(['z'], 'z'))).toMatchObject({ presence: 'replace', tails: 'settle' });
  });

  it('morphs without a header swap when the top record opens or collapses', () => {
    expect(planShell(view(['c', 'b', 'a'], 'c'), view(['c', 'b', 'a'], 'c', true))).toMatchObject({ morph: 'open', header: false, tails: 'none' });
    expect(planShell(view(['c', 'b', 'a'], 'c', true), view(['c', 'b', 'a'], 'c'))).toMatchObject({ morph: 'close', header: false });
  });

  it('blur-swaps the header in parallel with the morph when another record becomes presented', () => {
    // Collapsing while a not-top slide was current, and an attention open of a not-top initiator.
    expect(planShell(view(['c', 'b', 'a'], 'b', true), view(['c', 'b', 'a'], 'c'))).toMatchObject({ morph: 'close', header: true, slide: 0 });
    expect(planShell(view(['c', 'b', 'a'], 'c'), view(['c', 'b', 'a'], 'a', true))).toMatchObject({ morph: 'open', header: true });
  });

  it('slides towards older records and back, including after closing the current slide', () => {
    expect(planShell(view(['c', 'b', 'a'], 'c', true), view(['c', 'b', 'a'], 'b', true))).toMatchObject({ slide: 1, header: true, morph: 'none' });
    expect(planShell(view(['c', 'b', 'a'], 'a', true), view(['c', 'b', 'a'], 'c', true))).toMatchObject({ slide: -1 });
    // Close current: the next older takes the same index → forward; the last one falls back to the newer one.
    expect(planShell(view(['c', 'b', 'a'], 'b', true), view(['c', 'a'], 'a', true))).toMatchObject({ slide: 1 });
    expect(planShell(view(['c', 'b', 'a'], 'a', true), view(['c', 'b'], 'b', true))).toMatchObject({ slide: -1 });
  });

  it('swaps header and body of an updated current record and re-pends a new message', () => {
    const before = view(['a'], item('a', { title: 'Saving', kind: 'loading', text: 'One', operation: 'pending' }), true);
    const after = view(['a'], item('a', { title: 'Saved', kind: 'success', text: 'Two', operation: 'fulfilled' }), true);
    expect(planShell(before, after)).toMatchObject({ header: true, body: true, begin: true, slide: 0 });
    const retitled = view(['a'], item('a', { title: 'Saving…', kind: 'loading', text: 'One', operation: 'pending' }), true);
    expect(planShell(before, retitled)).toMatchObject({ header: true, body: false, begin: false });
    // The collapsed pill has no body.
    expect(planShell(view(['a'], item('a', { text: 'One' })), view(['a'], item('a', { text: 'Two' })))).toMatchObject({ header: false, body: false });
  });

  it('blur-swaps the badge number and the long indicator text only where they are visible', () => {
    expect(planShell(view(['b', 'a'], 'b'), view(['c', 'b', 'a'], 'c'))).toMatchObject({ badge: true });
    expect(planShell(view(['a'], 'a'), view(['b', 'a'], 'b'))).toMatchObject({ badge: false });
    // Missed notifications count in the badge, even with one record.
    expect(planShell(view(['a'], 'a', false, 1), view(['a'], 'a', false, 2))).toMatchObject({ badge: true });
    expect(planShell(view(['b', 'a'], 'b', false, 1), view(['b', 'a'], 'b'))).toMatchObject({ badge: true });
    expect(planShell(view(['a'], 'a', false, 1), view(['a'], 'a'))).toMatchObject({ badge: false });
    const six = ['f', 'e', 'd', 'c', 'b', 'a'];
    expect(planShell(view(six, 'f', true), view(six, 'e', true))).toMatchObject({ page: true, badge: false });
    expect(planShell(view(six.slice(1), 'e', true), view(six.slice(1), 'd', true))).toMatchObject({ page: false });
  });

  it('settles tails in place when the stack depth changes without a new top', () => {
    expect(planShell(view(['c', 'b', 'a'], 'c'), view(['c', 'a'], 'c'))).toMatchObject({ presence: 'none', tails: 'settle', badge: true });
    expect(planShell(view(['c', 'b', 'a'], 'c', true), view(['c', 'a'], 'c', true))).toMatchObject({ tails: 'none' });
  });
});
