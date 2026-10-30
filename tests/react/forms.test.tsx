import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CloudletProvider, Toaster, createCloudlet,
  type FormAction, type ReactCloudletController, type ReactNotificationSpec, type ToasterProps,
} from '../../packages/toast/src/index.js';
import { createDeferred } from '../support/deferred.js';

const controllers: ReactCloudletController[] = [];
const outside: Element[] = [];
function controller() {
  const instance = createCloudlet();
  controllers.push(instance);
  return instance;
}
function tree(instance: ReactCloudletController, options: ToasterProps = {}) {
  return <CloudletProvider controller={instance}><Toaster {...options} /></CloudletProvider>;
}
function openIsland() {
  const pill = document.querySelector<HTMLButtonElement>('[data-cloudlet-pill]');
  if (!pill) throw new Error('Pill not rendered');
  act(() => pill.click());
}
const host = () => screen.getByRole('region', { name: 'Notifications' });
const reply = (extra: Partial<FormAction> = {}): FormAction => ({
  kind: 'form', label: 'Send', run: vi.fn(),
  fields: [{ name: 'reply', kind: 'text', label: 'Reply', required: true }],
  ...extra,
});
const spec = (extra: Partial<ReactNotificationSpec> = {}): ReactNotificationSpec =>
  ({ id: 'anna', title: 'Anna: are you coming?', duration: null, attention: 'stack', action: reply(), ...extra });

beforeEach(() => vi.spyOn(document, 'hasFocus').mockReturnValue(true));
afterEach(() => {
  cleanup();
  controllers.splice(0).forEach((instance) => instance.dispose());
  outside.splice(0).forEach((element) => element.remove());
  vi.restoreAllMocks();
});

describe('form actions in the Island', () => {
  it('renders labelled fields and a round submit button named by the action label, only in the open Island', () => {
    const instance = controller();
    instance.show(spec({ action: reply({ fields: [
      { name: 'name', kind: 'text', label: 'Name', placeholder: 'Your name', autoComplete: 'name', inputMode: 'text', maxLength: 40 },
      { name: 'note', kind: 'textarea', label: 'Note', required: true },
    ] }) }));
    render(tree(instance));
    expect(document.querySelector('.cloudlet-form')).toBeNull();
    openIsland();

    const form = document.querySelector('form.cloudlet-form')!;
    expect(form).toHaveAttribute('aria-labelledby', document.querySelector('.cloudlet-title')!.id);
    const name = screen.getByRole('textbox', { name: 'Name' });
    expect(name).toHaveAttribute('placeholder', 'Your name');
    expect(name).toHaveAttribute('autocomplete', 'name');
    expect(name).toHaveAttribute('maxlength', '40');
    const note = screen.getByRole('textbox', { name: 'Note' });
    expect(note.tagName).toBe('TEXTAREA');
    expect(note).toBeRequired();
    expect(note).toHaveAttribute('placeholder', 'Note');
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toHaveAttribute('type', 'submit');
    // The button sits beside the last field only.
    expect(note.parentElement).toContainElement(send);
    expect(name.parentElement).not.toContainElement(send);
    expect(document.querySelectorAll('.cloudlet-actions .cloudlet-action')).toHaveLength(0);
  });

  it('shows the required message under the field, focuses it, and clears it when the field changes', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    const instance = controller();
    instance.show(spec({ action: reply({ run }) }));
    render(tree(instance));
    openIsland();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const field = screen.getByRole('textbox', { name: 'Reply' });
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription('This field is required');
    expect(run).not.toHaveBeenCalled();
    await user.type(field, 'Y');
    expect(field).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText('This field is required')).toBeNull();
  });

  it('sends on Enter in a text field, keeps the text read-only while pending and closes on success', async () => {
    const user = userEvent.setup();
    const sent = createDeferred<void>();
    const run = vi.fn(() => sent.promise);
    const instance = controller();
    instance.show(spec({ action: reply({ run }) }));
    render(tree(instance));
    openIsland();
    const field = screen.getByRole('textbox', { name: 'Reply' });
    await user.type(field, 'On my way{Enter}');
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ values: { reply: 'On my way' } }));
    expect(field).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('aria-busy', 'true');
    await act(async () => { sent.resolve(); await sent.promise; });
    expect(instance.getHandle('anna')).toBeUndefined();
  });

  it('keeps the text and describes the button with the error after a failed send', async () => {
    const user = userEvent.setup();
    const instance = controller();
    instance.show(spec({ action: reply({ run: () => Promise.reject(new Error('offline')), errorMessage: () => 'Could not send' }) }));
    render(tree(instance));
    openIsland();
    const field = screen.getByRole('textbox', { name: 'Reply' });
    await user.type(field, 'Late{Enter}');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(field).toHaveValue('Late');
    expect(field).not.toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAccessibleDescription('Could not send');
  });

  it('sends a textarea with Ctrl or ⌘ and Enter, while Enter alone adds a line', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    const instance = controller();
    instance.show(spec({ action: reply({ run, fields: [{ name: 'note', kind: 'textarea', label: 'Note' }] }) }));
    render(tree(instance));
    openIsland();
    const note = screen.getByRole('textbox', { name: 'Note' });
    await user.type(note, 'One{Enter}Two');
    expect(run).not.toHaveBeenCalled();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ values: { note: 'One\nTwo' } }));
  });

  it('leaves the arrows to the caret inside a field instead of switching slides', async () => {
    const user = userEvent.setup();
    const instance = controller();
    instance.show({ id: 'older', title: 'Older', duration: null, attention: 'stack' });
    instance.show(spec());
    render(tree(instance));
    openIsland();
    const field = screen.getByRole('textbox', { name: 'Reply' });
    await user.type(field, 'Yes{ArrowLeft}{ArrowRight}{Home}{End}');
    expect(instance.getSnapshot().island.current?.id).toBe('anna');
  });

  it('holds the Island open on an outside press while a draft exists, and Escape still collapses it with the draft kept', async () => {
    const user = userEvent.setup();
    const instance = controller();
    instance.show(spec());
    render(tree(instance));
    const button = document.createElement('button');
    document.body.append(button);
    outside.push(button);
    openIsland();
    fireEvent.pointerDown(button);
    expect(host()).toHaveAttribute('data-state', 'stack');

    openIsland();
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Typing');
    fireEvent.pointerDown(button);
    expect(host()).toHaveAttribute('data-state', 'island');

    await user.keyboard('{Escape}');
    expect(host()).toHaveAttribute('data-state', 'stack');
    expect(document.querySelector('[data-cloudlet-pill]')).toHaveAccessibleName('Anna: are you coming?, Draft');
    openIsland();
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('Typing');
  });

  it('names the draft with the draft label and adds the form parts to classNames', async () => {
    const user = userEvent.setup();
    const instance = controller();
    instance.show(spec());
    render(tree(instance, { labels: { draft: 'Entwurf' }, classNames: { form: 'app-form', field: 'app-field', 'field-error': 'app-error' } }));
    openIsland();
    expect(document.querySelector('.cloudlet-form')).toHaveClass('app-form');
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveClass('cloudlet-field', 'app-field');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(document.querySelector('.cloudlet-field-error')).toHaveClass('app-error');
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'x');
    await user.keyboard('{Escape}');
    expect(document.querySelector('[data-cloudlet-pill]')).toHaveAccessibleName('Anna: are you coming?, Entwurf');
  });
});
