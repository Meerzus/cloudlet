import { describe, expect, it } from 'vitest';
import type { ControllerOptions } from '../../packages/toast/src/contracts/controller.js';
import type { NotificationContent } from '../../packages/toast/src/contracts/notifications.js';
import { copyContent, patchContent, validateOptions, validatePatch, validateSpec } from '../../packages/toast/src/core/validation.js';
import { admit, harness, record } from '../support/controller-harness.js';

describe('controller input validation', () => {
  it('accepts documented content without trimming or interpreting opaque slots', () => {
    const slot = { interactiveApplicationObject: true };
    const spec = {
      id: ' event ', title: ' Saved ', kind: 'success', priority: 'high', dedupeKey: ' saved ',
      description: { kind: 'rich', content: slot, announcement: ' Details ' },
      icon: slot, progress: { kind: 'determinate', value: 1, label: '' },
      action: { kind: 'link', label: ' Open ', href: '/details', target: '_blank', rel: 'noopener' },
      duration: 0, announcementPriority: 'off', onClose: () => undefined,
    };
    expect(validateSpec(spec)).toEqual([]);
    expect(spec.title).toBe(' Saved ');
    expect(Object.isFrozen(slot)).toBe(false);
    expect(validateSpec({ title: 'Text', description: { kind: 'text', text: '' }, icon: null })).toEqual([]);
    expect(validateSpec({ title: 'Opaque undefined', description: { kind: 'rich', content: undefined, announcement: 'Details' } })).toEqual([]);
  });

  it.each([
    [null, ''], [[], ''], ['title', ''], [{}, 'title'], [{ title: ' ' }, 'title'],
    [{ title: 2 }, 'title'], [{ title: 'Valid', id: '' }, 'id'],
    [{ title: 'Valid', dedupeKey: ' ' }, 'dedupeKey'],
    [{ title: 'Valid', kind: 'unknown' }, 'kind'], [{ title: 'Valid', priority: 'urgent' }, 'priority'],
    [{ title: 'Valid', announcementPriority: 'loud' }, 'announcementPriority'],
    [{ title: 'Valid', duration: -1 }, 'duration'], [{ title: 'Valid', duration: Number.NaN }, 'duration'],
    [{ title: 'Valid', duration: Infinity }, 'duration'], [{ title: 'Valid', onClose: 'callback' }, 'onClose'],
    [{ title: 'Valid', description: null }, 'description'],
    [{ title: 'Valid', description: { kind: 'rich', content: {}, announcement: ' ' } }, 'description.announcement'],
    [{ title: 'Valid', description: { kind: 'rich', announcement: 'Details' } }, 'description.content'],
    [{ title: 'Valid', progress: { kind: 'determinate', value: 1.1 } }, 'progress.value'],
    [{ title: 'Valid', progress: { kind: 'determinate', value: -0.1 } }, 'progress.value'],
    [{ title: 'Valid', progress: { kind: 'determinate', value: Number.NaN } }, 'progress.value'],
    [{ title: 'Valid', progress: { kind: 'indeterminate', value: 0.3 } }, 'progress.value'],
    [{ title: 'Valid', action: { kind: 'command', label: 'Run', run: null } }, 'action.run'],
    [{ title: 'Valid', action: { kind: 'command', label: '', run: () => undefined } }, 'action.label'],
    [{ title: 'Valid', action: { kind: 'link', label: 'Open', href: '' } }, 'action.href'],
    [{ title: 'Valid', action: { kind: 'link', label: 'Open', href: '/', target: 'popup' } }, 'action.target'],
    [{ title: 'Valid', attention: 'always' }, 'attention'], [{ title: 'Valid', attention: null }, 'attention'],
  ])('rejects invalid input %# at its field path', (value, path) => {
    expect(validateSpec(value).some((issue) => issue.path === path)).toBe(true);
  });

  it('rejects unknown fields, incompatible union fields, accessors, and explicit undefined', () => {
    for (const field of ['title', 'id', 'kind', 'priority', 'dedupeKey', 'description', 'icon', 'progress', 'action', 'announcementPriority', 'duration', 'attention', 'onClose']) {
      expect(validateSpec({ title: 'Valid', [field]: undefined }).some(({ path }) => path === field)).toBe(true);
    }
    expect(validateSpec({ title: 'Valid', arbitrary: true })).toContainEqual({ path: 'arbitrary', message: 'Unknown field' });
    expect(validateSpec({ title: 'Valid', action: { kind: 'command', label: 'Run', run: () => undefined, href: '/' } })
      .some(({ path }) => path === 'action.href')).toBe(true);
    expect(validateSpec({ title: 'Valid', description: { kind: 'text', text: '', content: {} } })
      .some(({ path }) => path === 'description.content')).toBe(true);
    expect(validateSpec({ title: 'Valid', progress: { kind: 'indeterminate', label: undefined } })
      .some(({ path }) => path === 'progress.label')).toBe(true);
    expect(validateSpec(Object.defineProperty({}, 'title', { get: () => { throw new Error('Must not execute'); } })))
      .toContainEqual({ path: 'title', message: 'Expected a data property' });
    expect(validateSpec(Object.create({ title: 'Inherited' }))).not.toEqual([]);
    expect(validateSpec({ title: 'Valid', [Symbol('unknown')]: 1 })).not.toEqual([]);
  });

  it.each(['/', '../details', 'details?query=value', '#details', '//example.com', 'https://example.com', 'HTTP://example.com', 'mailto:owner@example.com', 'tel:+1000000', '/page?redirect=javascript:bad', ' https://example.com '])(
    'accepts safe navigation %s', (href) => {
      expect(validateSpec({ title: 'Link', action: { kind: 'link', label: 'Open', href } })).toEqual([]);
    },
  );

  it.each(['javascript:alert(1)', ' JAVASCRIPT:alert(1)', 'data:text/html,bad', 'vbscript:bad', 'custom:value', 'java\nscript:alert(1)', '\tjavascript:alert(1)', 'https:\u0000//example.com', 'java script:bad', '\u200bjavascript:bad', ':invalid']) (
    'rejects unsafe or unsupported navigation %s', (href) => {
      expect(validateSpec({ title: 'Link', action: { kind: 'link', label: 'Open', href } })
        .some(({ path }) => path === 'action.href')).toBe(true);
    },
  );

  it('accepts removals and persistent duration but never identity changes through patches', () => {
    expect(validatePatch({})).toEqual([]);
    expect(validatePatch({ description: null, icon: null, progress: null, action: null, duration: null })).toEqual([]);
    for (const key of ['id', 'dedupeKey', 'onClose', 'extra']) {
      expect(validatePatch({ [key]: 'value' })).toContainEqual({ path: key, message: 'Unknown field' });
    }
    for (const key of ['title', 'kind', 'priority', 'description', 'icon', 'progress', 'action', 'duration', 'announcementPriority']) {
      expect(validatePatch({ [key]: undefined }).some(({ path }) => path === key)).toBe(true);
    }
    const issues = validatePatch({ title: null, duration: -1 });
    expect(issues.map(({ path }) => path)).toEqual(['title', 'duration']);
    expect(Object.isFrozen(issues)).toBe(true);
    expect(issues.every(Object.isFrozen)).toBe(true);
  });
});

describe('controller options', () => {
  it('copies and freezes owned options while preserving callback identity', () => {
    const onDiagnostic = () => undefined;
    const onOverflow = () => undefined;
    const messages = { actionError: 'Action failed' };
    const options = { autoDismiss: false, messages, onDiagnostic, onOverflow };
    const copy = validateOptions(options);
    expect(copy).toEqual(options);
    expect(copy).not.toBe(options);
    expect(copy.messages).not.toBe(messages);
    expect(copy.onDiagnostic).toBe(onDiagnostic);
    expect(copy.onOverflow).toBe(onOverflow);
    expect(Object.isFrozen(copy)).toBe(true);
    expect(Object.isFrozen(copy.messages)).toBe(true);
    expect(Object.isFrozen(messages)).toBe(false);
    expect(Object.isFrozen(onDiagnostic)).toBe(false);
    messages.actionError = 'Changed';
    expect(copy.messages?.actionError).toBe('Action failed');
    expect(validateOptions(undefined)).toEqual({ autoDismiss: true });
    expect(validateOptions({})).toEqual({ autoDismiss: true });
  });

  it.each([null, [], false, { autoDismiss: 1 }, { autoDismiss: undefined }, { onOverflow: null }, { onDiagnostic: 'callback' }, { messages: null }, { messages: { actionError: false } }, { messages: { unknown: 'text' } }, { messages: { renderError: undefined } }, { capacity: 101 }])(
    'throws TypeError for malformed constructor options %#', (value) => {
      expect(() => validateOptions(value as ControllerOptions)).toThrow(TypeError);
    },
  );
});

describe('immutable presentation content', () => {
  it('copies only owned structures and keeps slot payloads and functions opaque', () => {
    const slot = { mutable: { value: 1 } };
    const run = () => undefined;
    const content = {
      title: ' Original ', description: { kind: 'rich' as const, content: slot, announcement: 'Details' },
      icon: slot, progress: { kind: 'determinate' as const, value: 0.25 },
      action: { kind: 'command' as const, label: 'Run', run },
      duration: 500, privateCallerData: 'Must not enter the snapshot',
    };
    const copy = copyContent(content);
    expect(copy.title).toBe(' Original ');
    expect(copy.announcementPriority).toBe('polite');
    expect(copy).not.toHaveProperty('privateCallerData');
    expect(copy.description).not.toBe(content.description);
    expect(copy.progress).not.toBe(content.progress);
    expect(copy.action).not.toBe(content.action);
    expect(copy.icon).toBe(slot);
    expect(copy.description?.kind === 'rich' && copy.description.content).toBe(slot);
    expect(copy.action?.kind === 'command' && copy.action.run).toBe(run);
    for (const value of [copy, copy.description, copy.progress, copy.action]) expect(Object.isFrozen(value)).toBe(true);
    for (const value of [content, slot, slot.mutable, run]) expect(Object.isFrozen(value)).toBe(false);
    content.title = 'Changed';
    content.description.announcement = 'Changed';
    content.progress.value = 0.8;
    content.action.label = 'Changed';
    expect(copy.title).toBe(' Original ');
    expect(copy.description?.kind === 'rich' && copy.description.announcement).toBe('Details');
    expect(copy.progress?.kind === 'determinate' && copy.progress.value).toBe(0.25);
    expect(copy.action?.label).toBe('Run');
  });

  it('preserves omitted fields, removes nullable fields, and keeps old snapshots unchanged', () => {
    const original = copyContent({
      title: 'Original', description: { kind: 'text', text: 'Details' }, icon: { name: 'icon' },
      progress: { kind: 'indeterminate' }, action: { kind: 'link', label: 'Open', href: '/' }, duration: 600,
    });
    const updated = patchContent(original, { title: 'Updated', progress: { kind: 'determinate', value: 0.5 } });
    expect(updated).toMatchObject({ title: 'Updated', description: { kind: 'text', text: 'Details' }, duration: 600 });
    expect(updated.icon).toBe(original.icon);
    expect(original).toMatchObject({ title: 'Original', progress: { kind: 'indeterminate' } });
    const removed = patchContent(updated, { description: null, icon: null, progress: null, action: null, duration: null });
    expect(removed).toEqual({ title: 'Updated', announcementPriority: 'polite', duration: null });
    expect(Object.isFrozen(removed)).toBe(true);
    expect(updated).toHaveProperty('description');
    expect(updated).toHaveProperty('icon');
  });

  it('returns the same reference for content no-ops, including equivalent owned structures', () => {
    const slot = {};
    const run = () => undefined;
    const original: NotificationContent<object> = copyContent({
      title: 'Original', description: { kind: 'rich', content: slot, announcement: 'Details' }, icon: slot,
      progress: { kind: 'determinate', value: 0.5, label: 'Half' }, action: { kind: 'command', label: 'Run', run },
    });
    expect(patchContent(original, {})).toBe(original);
    expect(patchContent(original, { kind: 'error', priority: 'high' })).toBe(original);
    expect(patchContent(original, {
      title: 'Original', description: { kind: 'rich', content: slot, announcement: 'Details' }, icon: slot,
      progress: { kind: 'determinate', value: 0.5, label: 'Half' }, action: { kind: 'command', label: 'Run', run },
    })).toBe(original);
    const empty = copyContent({ title: 'Empty' });
    expect(patchContent(empty, { action: null, progress: null, description: null, icon: null })).toBe(empty);
    expect(patchContent(original, { icon: {} })).not.toBe(original);
  });

  it('validates attention on spec, patch and operation content and copies it with the content', () => {
    for (const attention of ['auto', 'open', 'stack']) {
      expect(validateSpec({ title: 'Valid', attention })).toEqual([]);
      expect(validatePatch({ attention })).toEqual([]);
    }
    expect(validatePatch({ attention: null })).toContainEqual({ path: 'attention', message: 'Expected one of: auto, open, stack' });
    const { controller } = harness();
    const shown = controller.show({ title: 'Invalid', attention: 'loud' as 'open' });
    expect(shown).toMatchObject({ status: 'rejected', reason: 'invalid-input', issues: [{ path: 'attention' }] });
    const handle = admit(controller, { title: 'Valid', attention: 'open' });
    expect(controller.update(handle, { attention: 'never' as 'stack' })).toMatchObject({ status: 'rejected', reason: 'invalid-input' });
    expect(record(controller, handle).content.attention).toBe('open');
    expect(controller.update(handle, { attention: 'open' })).toEqual({ status: 'unchanged' });
    expect(controller.update(handle, { attention: 'stack' })).toEqual({ status: 'applied' });
    expect(record(controller, handle).content).toEqual({ title: 'Valid', announcementPriority: 'polite', attention: 'stack' });
    const operation = controller.track(Promise.resolve(1), {
      pending: { title: 'Loading', attention: 'sometimes' as 'auto' }, success: { title: 'Done' }, error: { title: 'Failed' },
    });
    expect(operation.admission).toMatchObject({ status: 'rejected', reason: 'invalid-input', issues: [{ path: 'pending.attention' }] });
  });
});
