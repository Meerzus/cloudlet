import { createAgent, type Agent, type AgentChange } from '@cloudlet/agent';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ColorPicker, ColorPickerPanel, type ColorFormat } from '@/components/ui/color-picker/color-picker';
import { useColorPickerAgent, type ColorPickerAgentOptions } from '@/components/ui/color-picker/color-picker-agent';

/** A controlled owner: `accept` decides what the app does with a value the picker hands it. */
function Controlled({ agent, initial = '#007aff', accept = (value) => value, options = { label: 'Accent color' }, format, onChange }: {
  agent: Agent | null;
  initial?: string;
  accept?: (value: string) => string | null;
  options?: ColorPickerAgentOptions;
  format?: ColorFormat;
  onChange?: (value: string) => void;
}) {
  const [color, setColor] = useState(initial);
  const picker = useColorPickerAgent(agent, {
    color,
    ...(format ? { format } : {}),
    onChange: (value: string) => {
      onChange?.(value);
      const taken = accept(value);
      if (taken !== null) setColor(taken);
    },
  }, options);
  return (
    <>
      <ColorPickerPanel {...picker} />
      <output data-testid="color">{color}</output>
      <button type="button" onClick={() => setColor('#336699')}>App sets blue</button>
    </>
  );
}

const field = () => screen.getByRole('textbox', { name: 'Color value' });
const set = (agent: Agent, color: unknown, ref = 'color-picker') => act(() => agent.act({ steps: [{ ref, action: 'set', args: [color] }] }));
/** Collects every change record the bridge delivers. */
const recorder = (agent: Agent) => {
  const changes: AgentChange[] = [];
  agent.subscribe((delivered) => { changes.push(...delivered); });
  return changes;
};

describe('useColorPickerAgent', () => {
  it('puts the picker in the snapshot with its label, value, format, formats and alpha', () => {
    const agent = createAgent();
    render(<Controlled agent={agent} options={{ name: 'accent', label: 'Accent color' }} format="rgb" />);
    expect(agent.snapshot()).toEqual([{
      ref: 'accent', component: 'color-picker', actions: ['set'], label: 'Accent color',
      value: 'rgb(0 122 255)', format: 'rgb', formats: ['hex', 'rgb', 'hsl', 'oklch'], alpha: false,
    }]);
    expect(Object.isFrozen(agent.snapshot()[0])).toBe(true);
    expect(field()).toHaveValue('rgb(0 122 255)');
  });

  it('names the picker color-picker and labels it with labels.open, else "Pick color"', () => {
    const first = createAgent();
    const second = createAgent();
    function Pickers() {
      const named = useColorPickerAgent(first, { defaultColor: '#ff0000', labels: { open: 'Pick background' } });
      const plain = useColorPickerAgent(second, { defaultColor: '#00ff00' });
      return <><ColorPicker {...named} /><ColorPicker {...plain} /></>;
    }
    render(<Pickers />);
    expect(first.snapshot()[0]).toMatchObject({ ref: 'color-picker', label: 'Pick background', value: '#ff0000' });
    expect(second.snapshot()[0]).toMatchObject({ ref: 'color-picker', label: 'Pick color', value: '#00ff00' });
  });

  it('sets the color of a controlled picker and answers with the value that stood', async () => {
    const agent = createAgent();
    const onChange = vi.fn();
    render(<Controlled agent={agent} onChange={onChange} />);
    const result = await set(agent, 'rgb(255 0 0)');
    expect(result).toEqual({ ok: true, steps: [{ step: 0, ref: 'color-picker', result: '#ff0000' }] });
    expect(onChange).toHaveBeenCalledExactlyOnceWith('#ff0000');
    expect(screen.getByTestId('color')).toHaveTextContent('#ff0000');
    expect(field()).toHaveValue('#ff0000');
    expect(agent.snapshot()[0]).toMatchObject({ value: '#ff0000' });
  });

  it('writes the color in the current format and drops alpha the picker does not keep', async () => {
    const agent = createAgent();
    render(<Controlled agent={agent} format="hsl" />);
    const result = await set(agent, '#ff000080');
    expect(result.ok && result.steps[0]?.result).toBe('hsl(0 100% 50%)');
    expect(field()).toHaveValue('hsl(0 100% 50%)');
  });

  it('keeps alpha when the picker shows opacity', async () => {
    const agent = createAgent();
    function Alpha() {
      const picker = useColorPickerAgent(agent, { defaultColor: '#007aff', alpha: true });
      return <ColorPickerPanel {...picker} />;
    }
    render(<Alpha />);
    expect(agent.snapshot()[0]).toMatchObject({ alpha: true });
    const result = await set(agent, 'rgb(255 0 0 / 0.5)');
    expect(result.ok && result.steps[0]?.result).toBe('#ff000080');
  });

  it('holds the value and the format of an uncontrolled picker and still tells the app', async () => {
    const agent = createAgent();
    const onChange = vi.fn();
    function Uncontrolled() {
      const picker = useColorPickerAgent(agent, { defaultColor: '#007aff', defaultFormat: 'rgb', onChange });
      return <ColorPicker {...picker} />;
    }
    render(<Uncontrolled />);
    expect(agent.snapshot()[0]).toMatchObject({ value: 'rgb(0 122 255)', format: 'rgb' });
    const result = await set(agent, '#00ff00');
    expect(result.ok && result.steps[0]?.result).toBe('rgb(0 255 0)');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('rgb(0 255 0)');
    fireEvent.click(screen.getByRole('button', { name: 'Pick color' }));
    expect(field()).toHaveValue('rgb(0 255 0)');
  });

  it('shows white, as the picker does, for an uncontrolled picker without a color', () => {
    const agent = createAgent();
    function Blank() {
      return <ColorPickerPanel {...useColorPickerAgent(agent, {})} />;
    }
    render(<Blank />);
    expect(agent.snapshot()[0]).toMatchObject({ value: '#ffffff' });
    expect(field()).toHaveValue('#ffffff');
  });

  it('refuses a string the picker cannot read and leaves the color alone', async () => {
    const agent = createAgent();
    const onChange = vi.fn();
    render(<Controlled agent={agent} onChange={onChange} />);
    const result = await set(agent, 'banana');
    expect(result).toEqual({
      ok: false, steps: [],
      error: { step: 0, message: '"banana" is not a color "Accent color" can read. Use hex, rgb(), hsl() or oklch().' },
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(field()).toHaveValue('#007aff');
  });

  it.each([[[]], [[1]], [['#ff0000', '#00ff00']], [[null]]])('refuses arguments %j that are not one color', async (args) => {
    const agent = createAgent();
    const onChange = vi.fn();
    render(<Controlled agent={agent} onChange={onChange} />);
    const result = await act(() => agent.act({ steps: [{ ref: 'color-picker', action: 'set', args }] }));
    expect(result).toEqual({ ok: false, steps: [], error: { step: 0, message: '"set" on "color-picker" takes a color.' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('answers an unknown verb with the record\'s actions', async () => {
    const agent = createAgent();
    render(<Controlled agent={agent} />);
    const result = await act(() => agent.act({ steps: [{ ref: 'color-picker', action: 'open' }] }));
    expect(result).toMatchObject({ ok: false, error: { message: '"open" is not available on "color-picker" now. Available: set.' } });
  });

  it('treats the color already there as done, without calling onChange or reporting a change', async () => {
    const agent = createAgent();
    const onChange = vi.fn();
    render(<Controlled agent={agent} onChange={onChange} format="hsl" initial="hsl(0 0% 50%)" />);
    const changes = recorder(agent);
    // rgb(127 127 128) is written hsl(240 0% 50%), and the picker reads that back as hsl(0 0% 50%):
    // a gray keeps no hue. Handing it to the app would change nothing on screen.
    for (const color of ['hsl(0 0% 50%)', '#808080', 'rgb(127 127 128)']) {
      const result = await set(agent, color);
      expect(result).toEqual({ ok: true, steps: [{ step: 0, ref: 'color-picker', result: 'hsl(0 0% 50%)' }] });
    }
    expect(onChange).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
  });

  it('reports an app that did not take the value', async () => {
    const agent = createAgent();
    render(<Controlled agent={agent} accept={() => null} />);
    const changes = recorder(agent);
    const result = await set(agent, '#ff0000');
    expect(result).toEqual({
      ok: false, steps: [],
      error: { step: 0, message: 'The app did not take "#ff0000": "Accent color" is still "#007aff".' },
    });
    expect(field()).toHaveValue('#007aff');
    expect(changes).toEqual([]);
  });

  it('answers with what the app set instead, and the change is still the agent\'s', async () => {
    const agent = createAgent();
    render(<Controlled agent={agent} accept={() => '#00ff00'} />);
    const changes = recorder(agent);
    const result = await set(agent, '#ff0000');
    expect(result.ok && result.steps[0]?.result).toBe('#00ff00');
    expect(changes).toEqual([{ ref: 'color-picker', component: 'color-picker', label: 'Accent color', key: 'color', value: '#00ff00', previous: '#007aff', source: 'agent' }]);
  });

  it('lets the second step of one call see what the first one set', async () => {
    const agent = createAgent();
    const onChange = vi.fn();
    render(<Controlled agent={agent} onChange={onChange} />);
    const result = await act(() => agent.act({ steps: [
      { ref: 'color-picker', action: 'set', args: ['#ff0000'] },
      { ref: 'color-picker', action: 'set', args: ['rgb(255 0 0)'] },
      { ref: 'color-picker', action: 'set', args: ['#00ff00'] },
    ] }));
    expect(result).toEqual({ ok: true, steps: [
      { step: 0, ref: 'color-picker', result: '#ff0000' },
      { step: 1, ref: 'color-picker', result: '#ff0000' },
      { step: 2, ref: 'color-picker', result: '#00ff00' },
    ] });
    expect(onChange.mock.calls).toEqual([['#ff0000'], ['#00ff00']]);
  });

  it('reports who changed the color: a person, an agent, the app', async () => {
    const agent = createAgent();
    render(<Controlled agent={agent} />);
    const changes = recorder(agent);
    fireEvent.change(field(), { target: { value: '#123456' } });
    await set(agent, '#ff0000');
    fireEvent.click(screen.getByRole('button', { name: 'App sets blue' }));
    expect(changes).toEqual([
      { ref: 'color-picker', component: 'color-picker', label: 'Accent color', key: 'color', value: '#123456', previous: '#007aff', source: 'user' },
      { ref: 'color-picker', component: 'color-picker', label: 'Accent color', key: 'color', value: '#ff0000', previous: '#123456', source: 'agent' },
      { ref: 'color-picker', component: 'color-picker', label: 'Accent color', key: 'color', value: '#336699', previous: '#ff0000', source: 'app' },
    ]);
    expect(changes.every((change) => Object.isFrozen(change))).toBe(true);
  });

  it('reports a person switching the format as a change of the same key', () => {
    const agent = createAgent();
    render(<Controlled agent={agent} />);
    const changes = recorder(agent);
    fireEvent.click(screen.getByRole('radio', { name: 'rgb' }));
    expect(changes).toEqual([{ ref: 'color-picker', component: 'color-picker', label: 'Accent color', key: 'color', value: 'rgb(0 122 255)', previous: '#007aff', source: 'user' }]);
    expect(agent.snapshot()[0]).toMatchObject({ value: 'rgb(0 122 255)', format: 'rgb' });
  });

  it('follows a controlled format the app changes, as the app\'s change', () => {
    const agent = createAgent();
    function Owner() {
      const [format, setFormat] = useState<ColorFormat>('hex');
      const picker = useColorPickerAgent(agent, { color: '#ff8000', format, onFormatChange: setFormat });
      return <><ColorPickerPanel {...picker} /><button type="button" onClick={() => setFormat('oklch')}>oklch</button></>;
    }
    render(<Owner />);
    const changes = recorder(agent);
    fireEvent.click(screen.getByRole('button', { name: 'oklch' }));
    expect(field()).toHaveValue(agent.snapshot()[0]?.value as string);
    expect(changes).toMatchObject([{ key: 'color', previous: '#ff8000', source: 'app' }]);
  });

  it('does not hand a person\'s mark the app ignored to the app\'s own change later', () => {
    const agent = createAgent();
    let accept = false;
    render(<Controlled agent={agent} accept={(value) => (accept ? value : null)} />);
    const changes = recorder(agent);
    fireEvent.change(field(), { target: { value: '#123456' } });
    expect(agent.snapshot()[0]).toMatchObject({ value: '#007aff' });
    expect(changes).toEqual([]);
    accept = true;
    fireEvent.click(screen.getByRole('button', { name: 'App sets blue' }));
    expect(changes).toMatchObject([{ value: '#336699', previous: '#007aff', source: 'app' }]);
  });

  it('does not hand an agent\'s mark the app ignored to a person\'s change later', async () => {
    const agent = createAgent();
    let accept = false;
    render(<Controlled agent={agent} accept={(value) => (accept ? value : null)} />);
    const changes = recorder(agent);
    expect((await set(agent, '#ff0000')).ok).toBe(false);
    accept = true;
    fireEvent.change(field(), { target: { value: '#123456' } });
    expect(changes).toMatchObject([{ value: '#123456', previous: '#007aff', source: 'user' }]);
  });

  it('marks only the picker that started the change when two share the app\'s color', async () => {
    const agent = createAgent();
    function Shared() {
      const [color, setColor] = useState('#007aff');
      const first = useColorPickerAgent(agent, { color, onChange: setColor }, { name: 'first' });
      const second = useColorPickerAgent(agent, { color, onChange: setColor }, { name: 'second' });
      return <><div data-testid="first"><ColorPickerPanel {...first} /></div><ColorPickerPanel {...second} /></>;
    }
    render(<Shared />);
    const changes = recorder(agent);
    fireEvent.change(within(screen.getByTestId('first')).getByRole('textbox', { name: 'Color value' }), { target: { value: '#123456' } });
    await set(agent, '#ff0000', 'second');
    expect(changes.map(({ ref, value, source }) => [ref, value, source])).toEqual([
      ['first', '#123456', 'user'], ['second', '#123456', 'app'],
      ['first', '#ff0000', 'app'], ['second', '#ff0000', 'agent'],
    ]);
  });

  it('answers done and gone when the app unmounts the picker in answer to a step', async () => {
    const agent = createAgent();
    function Owner() {
      const [shown, setShown] = useState(true);
      return shown ? <Controlled agent={agent} onChange={() => setShown(false)} /> : <p>Picker closed</p>;
    }
    render(<Owner />);
    expect(await set(agent, '#ff0000')).toEqual({ ok: true, steps: [{ step: 0, ref: 'color-picker', gone: true }] });
    expect(screen.getByText('Picker closed')).toBeInTheDocument();
    expect(agent.snapshot()).toEqual([]);
  });

  it('keeps the exact string a person emitted, where reading it back would round anew', () => {
    const agent = createAgent();
    render(<Controlled agent={agent} format="oklch" initial="#001219" />);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Saturation and brightness' }), { key: 'ArrowDown' });
    // Read back, oklch(16.1% 0.03 221.5) would be oklch(16.1% 0.03 221.8).
    expect(screen.getByTestId('color')).toHaveTextContent('oklch(16.1% 0.03 221.5)');
    expect(field()).toHaveValue('oklch(16.1% 0.03 221.5)');
    expect(agent.snapshot()[0]).toMatchObject({ value: 'oklch(16.1% 0.03 221.5)' });
  });

  it('keeps that string across a format switch the app later takes back', () => {
    const agent = createAgent();
    function Owner() {
      const [color, setColor] = useState('#001219');
      const [format, setFormat] = useState<ColorFormat>('oklch');
      const picker = useColorPickerAgent(agent, { color, onChange: setColor, format, onFormatChange: setFormat });
      return <><ColorPickerPanel {...picker} /><button type="button" onClick={() => setFormat('oklch')}>Back to oklch</button></>;
    }
    render(<Owner />);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Saturation and brightness' }), { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('radio', { name: 'hex' }));
    expect(agent.snapshot()[0]).toMatchObject({ value: '#001016', format: 'hex' });
    expect(field()).toHaveValue('#001016');
    fireEvent.click(screen.getByRole('button', { name: 'Back to oklch' }));
    expect(field()).toHaveValue('oklch(16.1% 0.03 221.5)');
    expect(agent.snapshot()[0]).toMatchObject({ value: 'oklch(16.1% 0.03 221.5)', format: 'oklch' });
  });

  it.each([null, undefined])('returns the props as they are and connects nothing when the agent is %s', (agent) => {
    const props = { defaultColor: '#007aff', onChange: () => {} };
    let returned: unknown;
    function Plain() {
      returned = useColorPickerAgent(agent, props);
      return <ColorPickerPanel {...props} />;
    }
    render(<Plain />);
    expect(returned).toBe(props);
  });

  it('refuses a second picker with the same name on one agent, and takes it under its own name', () => {
    const agent = createAgent();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Two({ name }: { name?: string }) {
      const first = useColorPickerAgent(agent, { defaultColor: '#ff0000' });
      const second = useColorPickerAgent(agent, { defaultColor: '#00ff00' }, name ? { name } : {});
      return <><ColorPicker {...first} /><ColorPicker {...second} /></>;
    }
    expect(() => render(<Two />)).toThrow(new TypeError('A component named "color-picker" is already connected'));
    error.mockRestore();
    render(<Two name="secondary" />);
    expect(agent.snapshot().map(({ ref, value }) => [ref, value])).toEqual([['color-picker', '#ff0000'], ['secondary', '#00ff00']]);
  });

  it('connects once under StrictMode, steps and reports as usual, and leaves on unmount', async () => {
    const agent = createAgent();
    const { unmount } = render(<StrictMode><Controlled agent={agent} /></StrictMode>);
    expect(agent.snapshot()).toHaveLength(1);
    const changes = recorder(agent);
    const result = await set(agent, '#ff0000');
    expect(result.ok && result.steps[0]?.result).toBe('#ff0000');
    fireEvent.change(field(), { target: { value: '#123456' } });
    expect(changes.map(({ value, source }) => [value, source])).toEqual([['#ff0000', 'agent'], ['#123456', 'user']]);
    unmount();
    expect(agent.snapshot()).toEqual([]);
  });

  it('takes a step the app starts from an effect: the bridge runs it after the commit, not inside it', async () => {
    const agent = createAgent();
    let pending: Promise<unknown> | undefined;
    const error = vi.spyOn(console, 'error');
    function Starter({ children }: { children: ReactNode }) {
      useEffect(() => { pending = agent.act({ steps: [{ ref: 'color-picker', action: 'set', args: ['#ff0000'] }] }); }, []);
      return children;
    }
    render(<Starter><Controlled agent={agent} /></Starter>);
    await act(async () => { await pending; });
    await expect(pending).resolves.toMatchObject({ ok: true, steps: [{ result: '#ff0000' }] });
    expect(field()).toHaveValue('#ff0000');
    expect(error).not.toHaveBeenCalled();
  });
});
