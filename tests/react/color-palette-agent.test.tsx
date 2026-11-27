import { createAgent, type Agent, type AgentChange } from '@cloudlet/agent';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ColorPalette, type ColorPaletteProps } from '@/components/ui/color-palette/color-palette';
import { useColorPaletteAgent, type ColorPaletteAgentOptions } from '@/components/ui/color-palette/color-palette-agent';

/** A controlled owner: `accept` decides what the app does with the colors the palette hands it. */
function Controlled({ agent, initial = ['#ff0000', '#00ff00'], accept = (colors) => colors, options = { label: 'Brand palette' }, onChange, ...props }: Omit<ColorPaletteProps, 'colors' | 'onChange'> & {
  agent: Agent | null;
  initial?: string[];
  accept?: (colors: string[]) => string[] | null;
  options?: ColorPaletteAgentOptions;
  onChange?: (colors: string[]) => void;
}) {
  const [colors, setColors] = useState(initial);
  const palette = useColorPaletteAgent(agent, {
    ...props,
    colors,
    onChange: (next: string[]) => {
      onChange?.(next);
      const taken = accept(next);
      if (taken !== null) setColors(taken);
    },
  }, options);
  return (
    <>
      <ColorPalette {...palette} />
      <output data-testid="colors">{colors.join(' ')}</output>
      <button type="button" onClick={() => setColors(['#336699'])}>App sets one</button>
    </>
  );
}

const group = (name = 'Palette') => screen.getByRole('group', { name });
const swatches = (name?: string) => within(group(name)).getAllByRole('button', { name: /^Color \d of \d/ }).map((button) => button.getAttribute('aria-label'));
const step = (agent: Agent, action: string, args: unknown[], ref = 'color-palette') => act(() => agent.act({ steps: [{ ref, action, args }] }));
const colorsOf = (agent: Agent, at = 0) => agent.snapshot()[at]?.colors;
/** Collects every change record the bridge delivers. */
const recorder = (agent: Agent) => {
  const changes: AgentChange[] = [];
  agent.subscribe((delivered) => { changes.push(...delivered); });
  return changes;
};
const change = (value: string[], previous: string[], source: AgentChange['source']) => ({
  ref: 'color-palette', component: 'color-palette', label: 'Brand palette', key: 'colors', value, previous, source,
});

describe('useColorPaletteAgent', () => {
  it('puts the palette in the snapshot as one record with its colors, max, format, formats and alpha', () => {
    const agent = createAgent();
    render(<Controlled agent={agent} options={{ name: 'brand', label: 'Brand palette' }} format="rgb" max={3} />);
    expect(agent.snapshot()).toEqual([{
      ref: 'brand', component: 'color-palette', actions: ['set', 'add', 'remove'], label: 'Brand palette',
      colors: ['rgb(255 0 0)', 'rgb(0 255 0)'], max: 3, format: 'rgb', formats: ['hex', 'rgb', 'hsl', 'oklch'], alpha: false,
    }]);
    expect(Object.isFrozen(agent.snapshot()[0])).toBe(true);
    expect(Object.isFrozen(colorsOf(agent))).toBe(true);
  });

  it('names the palette color-palette and labels it with labels.group, else "Palette"', () => {
    const first = createAgent();
    const second = createAgent();
    function Palettes() {
      const named = useColorPaletteAgent(first, { defaultColors: ['#ff0000'], labels: { group: 'Brand palette' } });
      const plain = useColorPaletteAgent(second, { defaultColors: ['#00ff00'] });
      return <><ColorPalette {...named} /><ColorPalette {...plain} /></>;
    }
    render(<Palettes />);
    expect(first.snapshot()[0]).toMatchObject({ ref: 'color-palette', label: 'Brand palette', colors: ['#ff0000'] });
    expect(second.snapshot()[0]).toMatchObject({ ref: 'color-palette', label: 'Palette', colors: ['#00ff00'] });
  });

  it('shows an empty array as the palette does: one default color, which cannot be removed', () => {
    const agent = createAgent();
    render(<Controlled agent={agent} initial={[]} />);
    expect(agent.snapshot()[0]).toMatchObject({ colors: ['#ffffff'], actions: ['set', 'add'] });
    expect(swatches()).toEqual(['Color 1 of 1, #ffffff']);
  });

  it('leaves add out of the actions at max', () => {
    const agent = createAgent();
    render(<Controlled agent={agent} max={2} />);
    expect(agent.snapshot()[0]).toMatchObject({ actions: ['set', 'remove'] });
  });

  it('lists the same colors as the palette\'s hidden fields', async () => {
    const agent = createAgent();
    const { container } = render(<Controlled agent={agent} initial={['#ff000080', 'hsl(120 100% 50%)', 'banana']} format="oklch" name="brand" />);
    const fields = () => [...container.querySelectorAll<HTMLInputElement>('input[type="hidden"][name="brand"]')].map((input) => input.value);
    expect(colorsOf(agent)).toEqual(fields());
    expect(fields()).toContain('banana');
    await step(agent, 'set', [0, '#123456']);
    await step(agent, 'remove', [2]);
    expect(colorsOf(agent)).toEqual(fields());
  });

  it('sets a color by its number and answers with the colors after the step', async () => {
    const agent = createAgent();
    const onChange = vi.fn();
    render(<Controlled agent={agent} onChange={onChange} />);
    const result = await step(agent, 'set', [1, 'rgb(0 0 255)']);
    expect(result).toEqual({ ok: true, steps: [{ step: 0, ref: 'color-palette', result: ['#ff0000', '#0000ff'] }] });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(['#ff0000', '#0000ff']);
    expect(screen.getByTestId('colors')).toHaveTextContent('#ff0000 #0000ff');
    expect(swatches()).toEqual(['Color 1 of 2, #ff0000', 'Color 2 of 2, #0000ff']);
  });

  it('adds a color at the end and removes a color by its number', async () => {
    const agent = createAgent();
    const onChange = vi.fn();
    render(<Controlled agent={agent} onChange={onChange} />);
    expect(await step(agent, 'add', ['#0000ff'])).toEqual({ ok: true, steps: [{ step: 0, ref: 'color-palette', result: ['#ff0000', '#00ff00', '#0000ff'] }] });
    expect(await step(agent, 'remove', [0])).toEqual({ ok: true, steps: [{ step: 0, ref: 'color-palette', result: ['#00ff00', '#0000ff'] }] });
    expect(onChange.mock.calls).toEqual([[['#ff0000', '#00ff00', '#0000ff']], [['#00ff00', '#0000ff']]]);
    expect(swatches()).toEqual(['Color 1 of 2, #00ff00', 'Color 2 of 2, #0000ff']);
  });

  it('hands the app every color in the current format and drops alpha the palette does not keep', async () => {
    const agent = createAgent();
    const onChange = vi.fn();
    render(<Controlled agent={agent} initial={['#ff0000', 'rgb(0 255 0)']} format="hsl" onChange={onChange} />);
    const result = await step(agent, 'add', ['#0000ff80']);
    expect(result.ok && result.steps[0]?.result).toEqual(['hsl(0 100% 50%)', 'hsl(120 100% 50%)', 'hsl(240 100% 50%)']);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(['hsl(0 100% 50%)', 'hsl(120 100% 50%)', 'hsl(240 100% 50%)']);
  });

  it('keeps alpha when the palette shows opacity', async () => {
    const agent = createAgent();
    function Alpha() {
      return <ColorPalette {...useColorPaletteAgent(agent, { defaultColors: ['#ff0000'], alpha: true })} />;
    }
    render(<Alpha />);
    const result = await step(agent, 'set', [0, 'rgb(0 0 255 / 0.5)']);
    expect(result.ok && result.steps[0]?.result).toEqual(['#0000ff80']);
  });

  it('holds the colors and the format of an uncontrolled palette, takes all three steps and still tells the app', async () => {
    const agent = createAgent();
    const onChange = vi.fn();
    function Uncontrolled() {
      return <ColorPalette {...useColorPaletteAgent(agent, { defaultColors: ['#ff0000'], defaultFormat: 'rgb', onChange })} />;
    }
    render(<Uncontrolled />);
    expect(agent.snapshot()[0]).toMatchObject({ colors: ['rgb(255 0 0)'], format: 'rgb' });
    expect(await step(agent, 'set', [0, '#00ff00'])).toMatchObject({ ok: true, steps: [{ result: ['rgb(0 255 0)'] }] });
    expect(await step(agent, 'add', ['#0000ff'])).toMatchObject({ ok: true, steps: [{ result: ['rgb(0 255 0)', 'rgb(0 0 255)'] }] });
    expect(await step(agent, 'remove', [0])).toMatchObject({ ok: true, steps: [{ result: ['rgb(0 0 255)'] }] });
    expect(onChange.mock.calls).toEqual([[['rgb(0 255 0)']], [['rgb(0 255 0)', 'rgb(0 0 255)']], [['rgb(0 0 255)']]]);
    expect(swatches()).toEqual(['Color 1 of 1, rgb(0 0 255)']);
  });

  it('refuses a string the palette cannot read and leaves the colors alone', async () => {
    const agent = createAgent();
    const onChange = vi.fn();
    render(<Controlled agent={agent} onChange={onChange} />);
    const message = '"banana" is not a color "Brand palette" can read. Use hex, rgb(), hsl() or oklch().';
    expect(await step(agent, 'set', [0, 'banana'])).toEqual({ ok: false, steps: [], error: { step: 0, message } });
    expect(await step(agent, 'add', ['banana'])).toEqual({ ok: false, steps: [], error: { step: 0, message } });
    expect(onChange).not.toHaveBeenCalled();
    expect(colorsOf(agent)).toEqual(['#ff0000', '#00ff00']);
  });

  it.each([['set', [5, '#0000ff']], ['set', [-1, '#0000ff']], ['remove', [5]]])('refuses %s of a color the palette does not have', async (action, args) => {
    const agent = createAgent();
    const onChange = vi.fn();
    render(<Controlled agent={agent} initial={['#ff0000', '#00ff00', '#0000ff']} onChange={onChange} />);
    const result = await step(agent, action, args);
    expect(result).toEqual({ ok: false, steps: [], error: { step: 0, message: `There is no color ${args[0]} in "Brand palette": it has colors 0–2.` } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('names the only color a palette of one has', async () => {
    const agent = createAgent();
    render(<Controlled agent={agent} initial={['#ff0000']} />);
    expect(await step(agent, 'set', [1, '#0000ff'])).toMatchObject({ error: { message: 'There is no color 1 in "Brand palette": it has only color 0.' } });
  });

  it('refuses add at max and keeps the number of colors', async () => {
    const agent = createAgent();
    const onChange = vi.fn();
    render(<Controlled agent={agent} max={2} onChange={onChange} />);
    expect(await step(agent, 'add', ['#0000ff'])).toEqual({ ok: false, steps: [], error: { step: 0, message: '"Brand palette" already holds 2 colors, its most.' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(swatches()).toHaveLength(2);
  });

  it('refuses to remove the last color', async () => {
    const agent = createAgent();
    const onChange = vi.fn();
    render(<Controlled agent={agent} initial={['#ff0000']} onChange={onChange} />);
    expect(await step(agent, 'remove', [0])).toEqual({ ok: false, steps: [], error: { step: 0, message: '"Brand palette" holds only one color, its least. Set it instead.' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(swatches()).toHaveLength(1);
  });

  it.each([
    ['set', [], 'the number of a color and a color'],
    ['set', ['#ff0000'], 'the number of a color and a color'],
    ['set', ['0', '#ff0000'], 'the number of a color and a color'],
    ['set', [0.5, '#ff0000'], 'the number of a color and a color'],
    ['set', [0, null], 'the number of a color and a color'],
    ['add', [], 'a color'],
    ['add', [0, '#ff0000'], 'a color'],
    ['remove', [], 'the number of a color'],
    ['remove', ['1'], 'the number of a color'],
  ])('refuses %s with arguments %j', async (action, args, what) => {
    const agent = createAgent();
    const onChange = vi.fn();
    render(<Controlled agent={agent} onChange={onChange} />);
    expect(await step(agent, action, args)).toEqual({ ok: false, steps: [], error: { step: 0, message: `"${action}" on "color-palette" takes ${what}.` } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('answers an unknown verb with the record\'s actions', async () => {
    const agent = createAgent();
    render(<Controlled agent={agent} />);
    expect(await step(agent, 'open', [])).toMatchObject({ ok: false, error: { message: '"open" is not available on "color-palette" now. Available: set, add, remove.' } });
  });

  it('treats the color already there as done, without calling onChange or reporting a change', async () => {
    const agent = createAgent();
    const onChange = vi.fn();
    render(<Controlled agent={agent} initial={['#FF0000', '#00ff00']} onChange={onChange} />);
    const changes = recorder(agent);
    for (const color of ['#FF0000', '#ff0000', 'rgb(255 0 0)']) {
      expect(await step(agent, 'set', [0, color])).toEqual({ ok: true, steps: [{ step: 0, ref: 'color-palette', result: ['#FF0000', '#00ff00'] }] });
    }
    expect(onChange).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
  });

  it('reports an app that did not take a step', async () => {
    const agent = createAgent();
    render(<Controlled agent={agent} accept={() => null} />);
    const changes = recorder(agent);
    expect(await step(agent, 'set', [1, '#0000ff'])).toMatchObject({ error: { message: 'The app did not take "#0000ff": color 1 of "Brand palette" is still "#00ff00".' } });
    expect(await step(agent, 'add', ['#0000ff'])).toMatchObject({ error: { message: 'The app did not take "#0000ff": "Brand palette" still holds 2 colors.' } });
    expect(await step(agent, 'remove', [0])).toMatchObject({ error: { message: 'The app did not remove color 0: "Brand palette" still holds 2 colors.' } });
    expect(colorsOf(agent)).toEqual(['#ff0000', '#00ff00']);
    expect(changes).toEqual([]);
  });

  it('answers with what the app set instead, and the change is still the agent\'s', async () => {
    const agent = createAgent();
    render(<Controlled agent={agent} accept={(colors) => colors.slice(0, 1)} />);
    const changes = recorder(agent);
    const result = await step(agent, 'add', ['#0000ff']);
    expect(result.ok && result.steps[0]?.result).toEqual(['#ff0000']);
    expect(changes).toEqual([change(['#ff0000'], ['#ff0000', '#00ff00'], 'agent')]);
  });

  it('lets the second step of one call see what the first one did', async () => {
    const agent = createAgent();
    const onChange = vi.fn();
    render(<Controlled agent={agent} onChange={onChange} />);
    const result = await act(() => agent.act({ steps: [
      { ref: 'color-palette', action: 'add', args: ['#0000ff'] },
      { ref: 'color-palette', action: 'set', args: [2, '#ffff00'] },
      { ref: 'color-palette', action: 'remove', args: [0] },
    ] }));
    expect(result).toEqual({ ok: true, steps: [
      { step: 0, ref: 'color-palette', result: ['#ff0000', '#00ff00', '#0000ff'] },
      { step: 1, ref: 'color-palette', result: ['#ff0000', '#00ff00', '#ffff00'] },
      { step: 2, ref: 'color-palette', result: ['#00ff00', '#ffff00'] },
    ] });
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('reports who changed the colors: a person, an agent, the app', async () => {
    const agent = createAgent();
    render(<Controlled agent={agent} />);
    const changes = recorder(agent);
    fireEvent.click(within(group()).getByRole('button', { name: 'Add color' }));
    const added = colorsOf(agent) as string[];
    expect(added).toHaveLength(3);
    fireEvent.keyDown(within(group()).getByRole('button', { name: /^Color 1 of 3/ }), { key: 'Delete' });
    await step(agent, 'set', [0, '#123456']);
    fireEvent.click(screen.getByRole('button', { name: 'App sets one' }));
    expect(changes).toEqual([
      change(added, ['#ff0000', '#00ff00'], 'user'),
      change(added.slice(1), added, 'user'),
      change(['#123456', added[2]!], added.slice(1), 'agent'),
      change(['#336699'], ['#123456', added[2]!], 'app'),
    ]);
    expect(changes.every((record) => Object.isFrozen(record))).toBe(true);
  });

  it('reports a person switching the format as a change of the colors', () => {
    const agent = createAgent();
    render(<Controlled agent={agent} />);
    fireEvent.click(within(group()).getByRole('button', { name: /^Color 1 of 2/ }));
    const changes = recorder(agent);
    fireEvent.click(screen.getByRole('radio', { name: 'rgb' }));
    expect(changes).toEqual([change(['rgb(255 0 0)', 'rgb(0 255 0)'], ['#ff0000', '#00ff00'], 'user')]);
    expect(agent.snapshot()[0]).toMatchObject({ format: 'rgb' });
  });

  it('does not hand a person\'s mark the app ignored to the app\'s own change later', () => {
    const agent = createAgent();
    render(<Controlled agent={agent} accept={() => null} />);
    const changes = recorder(agent);
    fireEvent.click(within(group()).getByRole('button', { name: 'Add color' }));
    expect(changes).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'App sets one' }));
    expect(changes).toEqual([change(['#336699'], ['#ff0000', '#00ff00'], 'app')]);
  });

  it.each([null, undefined])('returns the props as they are and connects nothing when the agent is %s', (agent) => {
    const props = { defaultColors: ['#ff0000'], onChange: () => {} };
    let returned: unknown;
    function Plain() {
      returned = useColorPaletteAgent(agent, props);
      return <ColorPalette {...props} />;
    }
    render(<Plain />);
    expect(returned).toBe(props);
  });

  it('refuses a second palette with the same name on one agent, and takes it under its own name', () => {
    const agent = createAgent();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Two({ name }: { name?: string }) {
      const first = useColorPaletteAgent(agent, { defaultColors: ['#ff0000'] });
      const second = useColorPaletteAgent(agent, { defaultColors: ['#00ff00'] }, name ? { name } : {});
      return <><ColorPalette {...first} /><ColorPalette {...second} /></>;
    }
    expect(() => render(<Two />)).toThrow(new TypeError('A component named "color-palette" is already connected'));
    error.mockRestore();
    render(<Two name="secondary" />);
    expect(agent.snapshot().map(({ ref, colors }) => [ref, colors])).toEqual([['color-palette', ['#ff0000']], ['secondary', ['#00ff00']]]);
  });

  it('connects once under StrictMode, steps and reports as usual, and leaves on unmount', async () => {
    const agent = createAgent();
    const { unmount } = render(<StrictMode><Controlled agent={agent} /></StrictMode>);
    expect(agent.snapshot()).toHaveLength(1);
    const changes = recorder(agent);
    expect(await step(agent, 'add', ['#0000ff'])).toMatchObject({ ok: true });
    fireEvent.keyDown(within(group()).getByRole('button', { name: /^Color 3 of 3/ }), { key: 'Delete' });
    expect(changes.map(({ source }) => source)).toEqual(['agent', 'user']);
    unmount();
    expect(agent.snapshot()).toEqual([]);
  });
});
