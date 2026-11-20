import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExampleBlock } from '../../apps/site/src/components/docs/example-block';
import { codeTokens } from '../../apps/site/src/lib/code-tokens';
import { exampleSource } from '../../apps/site/src/lib/example-source';

/**
 * The live example block: the component of the example file on the stage, the code of that file
 * under it, and Copy that gives exactly the file. The clipboard is the site's hook, stubbed here.
 */
const page = vi.hoisted(() => ({ copied: '' }));

vi.mock('@/components/site/notifications', () => ({
  useCopy: () => async (text: string) => {
    page.copied = text;
    return true;
  },
}));

afterEach(cleanup);

async function block(name: string) {
  const { file, code } = exampleSource(name);
  render(<ExampleBlock name={name} file={file} code={await codeTokens(code)} />);
  return { file, code };
}

describe('docs live example block', () => {
  it('renders the component of the file and the code of the file', async () => {
    const { code } = await block('color-picker/panel');
    const figure = document.querySelector('[data-example="color-picker/panel"]')!;
    // The live panel: its value field under the example's own label, and the area to move.
    expect(screen.getByRole('textbox', { name: 'Accent color' })).toHaveValue('#245cdb');
    expect(screen.getByRole('slider', { name: 'Saturation and brightness' })).toBeInTheDocument();
    expect(figure.querySelector('pre')?.textContent).toBe(code);
    expect(figure.querySelectorAll('pre .line')).toHaveLength(code.split('\n').length);
    expect(figure.querySelector('.docs-code-title')?.textContent).toBe('panel.tsx');
  });

  it('answers the keyboard in place', async () => {
    await block('color-picker/panel');
    const hue = screen.getByRole('slider', { name: 'Hue' });
    const before = hue.getAttribute('aria-valuenow');
    fireEvent.keyDown(hue, { key: 'ArrowRight' });
    expect(hue.getAttribute('aria-valuenow')).not.toBe(before);
    expect(screen.getByRole('textbox', { name: 'Accent color' })).not.toHaveValue('#245cdb');
  });

  it('copies exactly the file, and the button says so', async () => {
    const { code } = await block('color-picker/panel');
    fireEvent.click(screen.getByRole('button', { name: 'Copy panel.tsx' }));
    await act(async () => {});
    expect(page.copied).toBe(code);
    expect(screen.getByRole('button', { name: 'Copied panel.tsx' })).toBeInTheDocument();
  });

  it('fails on a name the list does not know', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ExampleBlock name="color-picker/nope" file="nope.tsx" code={[]} />)).toThrow(/Unknown example "color-picker\/nope"/u);
    error.mockRestore();
  });
});
