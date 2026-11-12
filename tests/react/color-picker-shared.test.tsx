import { Profiler, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ColorPicker, ColorPickerPanel } from '../../apps/site/src/components/ui/color-picker/color-picker';

/** Three controlled pickers on one color, like the landing: a change in one moves the others. */
function Shared({ commits }: { commits: { count: number } }) {
  const [color, setColor] = useState('#ff6a3d');
  return (
    <>
      <div role="group" aria-label="first">
        <ColorPickerPanel color={color} onChange={setColor} />
      </div>
      <Profiler id="second" onRender={() => void (commits.count += 1)}>
        <ColorPickerPanel color={color} onChange={setColor} format="oklch" />
      </Profiler>
      <ColorPicker color={color} onChange={setColor} />
    </>
  );
}

describe('controlled color pickers sharing one color', () => {
  it('follow each other in the same commit, without a second update from an effect', () => {
    const commits = { count: 0 };
    render(<Shared commits={commits} />);
    const [area] = screen.getAllByRole('slider', { name: 'Saturation and brightness' });
    fireEvent.keyDown(area!, { key: 'ArrowLeft' });
    const settled = commits.count;
    for (let index = 0; index < 20; index += 1) fireEvent.keyDown(area!, { key: 'ArrowLeft' });
    // One commit per change: an effect re-reading the prop added a second one each time (and on a fast
    // trackpad drag chained them until React warned of the update depth).
    expect(commits.count - settled).toBe(20);
    const [first, second] = screen.getAllByRole('textbox', { name: 'Color value' }) as HTMLInputElement[];
    expect(first!.value).not.toBe('#ff6a3d');
    expect(second!.value).toMatch(/^oklch\(/);
  });

  it('keeps the hue through zero saturation in the picker that moved it, and reads a new color from outside', () => {
    function Host() {
      const [color, setColor] = useState('#ff6a3d');
      return (
        <>
          <ColorPickerPanel color={color} onChange={setColor} />
          <button type="button" onClick={() => setColor('#2a6fdb')}>blue</button>
        </>
      );
    }
    render(<Host />);
    const area = screen.getByRole('slider', { name: 'Saturation and brightness' });
    const hue = screen.getByRole('slider', { name: 'Hue' });
    const before = hue.getAttribute('aria-valuenow');
    fireEvent.keyDown(area, { key: 'ArrowLeft', shiftKey: true });
    for (let index = 0; index < 12; index += 1) fireEvent.keyDown(area, { key: 'ArrowLeft', shiftKey: true });
    expect((screen.getByRole('textbox', { name: 'Color value' }) as HTMLInputElement).value).toMatch(/^#([\da-f]{2})\1\1$/);
    expect(hue.getAttribute('aria-valuenow')).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'blue' }));
    expect(screen.getByRole('textbox', { name: 'Color value' })).toHaveValue('#2a6fdb');
    expect(hue.getAttribute('aria-valuenow')).not.toBe(before);
  });
});
