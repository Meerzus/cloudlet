import { createAgent, type Agent, type AgentChange } from '@cloudlet/agent';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode, startTransition, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
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

describe('useColorPickerAgent on a color the app shares between pickers', () => {
  /** One picker of a shared color, in its own component, so React runs its effects on their own. */
  function Picker({ agent, name, color, onChange }: { agent: Agent; name: string; color: string; onChange: (value: string) => void }) {
    const picker = useColorPickerAgent(agent, { color, onChange }, { name });
    return <div data-testid={name}><ColorPickerPanel {...picker} /></div>;
  }
  /** Two pickers on one color; `accept` decides what the app does with a value either hands it. */
  function Shared({ first, second = first, accept = (value) => value }: { first: Agent; second?: Agent; accept?: (value: string) => string | null }) {
    const [color, setColor] = useState('#007aff');
    const take = (value: string) => {
      const taken = accept(value);
      if (taken !== null) setColor(taken);
    };
    return (
      <>
        <Picker agent={first} name="first" color={color} onChange={take} />
        <Picker agent={second} name="second" color={color} onChange={take} />
        <button type="button" onClick={() => setColor('#336699')}>App sets blue</button>
        <button type="button" onClick={() => setColor('#00aa00')}>App sets green</button>
      </>
    );
  }
  const type = (name: string, value: string) => fireEvent.change(within(screen.getByTestId(name)).getByRole('textbox', { name: 'Color value' }), { target: { value } });
  const sources = (changes: AgentChange[]) => changes.map(({ ref, value, source }) => [ref, value, source]);

  it('names who started the change on both pickers: a person, an agent, the app', async () => {
    const agent = createAgent();
    render(<Shared first={agent} />);
    const changes = recorder(agent);
    type('first', '#123456');
    type('second', '#654321');
    await set(agent, '#ff0000', 'second');
    await set(agent, '#00ff00', 'first');
    fireEvent.click(screen.getByRole('button', { name: 'App sets blue' }));
    expect(sources(changes)).toEqual([
      ['first', '#123456', 'user'], ['second', '#123456', 'user'],
      ['first', '#654321', 'user'], ['second', '#654321', 'user'],
      ['first', '#ff0000', 'agent'], ['second', '#ff0000', 'agent'],
      ['first', '#00ff00', 'agent'], ['second', '#00ff00', 'agent'],
      ['first', '#336699', 'app'], ['second', '#336699', 'app'],
    ]);
  });

  it('hands a mark the app did not take to neither picker: the app\'s own change after it is the app\'s', async () => {
    const agent = createAgent();
    render(<Shared first={agent} accept={() => null} />);
    const changes = recorder(agent);
    expect((await set(agent, '#ff0000', 'second')).ok).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'App sets blue' }));
    type('first', '#123456');
    fireEvent.click(screen.getByRole('button', { name: 'App sets green' }));
    expect(sources(changes)).toEqual([
      ['first', '#336699', 'app'], ['second', '#336699', 'app'],
      ['first', '#00aa00', 'app'], ['second', '#00aa00', 'app'],
    ]);
  });

  it.each([
    ['an effect', useEffect],
    ['a layout effect', useLayoutEffect],
  ])('names the app for a value the app passes on to the other picker in %s, a commit later', async (_, useRelay) => {
    const agent = createAgent();
    function Relayed() {
      const [color, setColor] = useState('#007aff');
      const [copy, setCopy] = useState('#007aff');
      useRelay(() => { setCopy(color); }, [color]);
      return <><Picker agent={agent} name="first" color={color} onChange={setColor} /><Picker agent={agent} name="second" color={copy} onChange={setCopy} /></>;
    }
    render(<Relayed />);
    const changes = recorder(agent);
    type('first', '#123456');
    await set(agent, '#ff0000', 'first');
    expect(sources(changes)).toEqual([
      ['first', '#123456', 'user'], ['second', '#123456', 'app'],
      ['first', '#ff0000', 'agent'], ['second', '#ff0000', 'app'],
    ]);
  });

  it('forgets the mark of a picker the app unmounts in answer to its step: the app\'s later change elsewhere is the app\'s', async () => {
    const agent = createAgent();
    function Gone() {
      const [shown, setShown] = useState(true);
      return shown ? <Picker agent={agent} name="first" color="#007aff" onChange={() => setShown(false)} /> : null;
    }
    function Other() {
      const [color, setColor] = useState('#007aff');
      return <><Picker agent={agent} name="second" color={color} onChange={setColor} /><button type="button" onClick={() => setColor('#336699')}>App sets blue</button></>;
    }
    render(<><Gone /><Other /></>);
    const changes = recorder(agent);
    expect(await set(agent, '#ff0000', 'first')).toMatchObject({ ok: true, steps: [{ gone: true }] });
    fireEvent.click(screen.getByRole('button', { name: 'App sets blue' }));
    expect(sources(changes)).toEqual([['second', '#336699', 'app']]);
  });

  it('marks nothing for a color a picker hears after it unmounted: the app\'s later change elsewhere is the app\'s', async () => {
    let answer: (result: { sRGBHex: string }) => void = () => {};
    vi.stubGlobal('EyeDropper', class { open() { return new Promise((resolve) => { answer = resolve; }); } });
    try {
      const agent = createAgent();
      function Owner() {
        const [shown, setShown] = useState(true);
        const [color, setColor] = useState('#007aff');
        // The app keeps the picked color where no picker shows it.
        const picked = useRef(color);
        return (
          <>
            {shown ? <Picker agent={agent} name="first" color="#007aff" onChange={(value) => { picked.current = value; }} /> : null}
            <Picker agent={agent} name="second" color={color} onChange={setColor} />
            <button type="button" onClick={() => setShown(false)}>Hide</button>
            <button type="button" onClick={() => setColor('#336699')}>App sets blue</button>
          </>
        );
      }
      render(<Owner />);
      const changes = recorder(agent);
      fireEvent.click(within(screen.getByTestId('first')).getByRole('button', { name: 'Pick from screen' }));
      fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
      // The eyedropper answers once the picker is gone.
      await act(async () => { answer({ sRGBHex: '#ff0000' }); });
      fireEvent.click(screen.getByRole('button', { name: 'App sets blue' }));
      expect(sources(changes)).toEqual([['second', '#336699', 'app']]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps a mark a person sets after a commit and before its passive effects for the commit it belongs to', async () => {
    // Without act, so React schedules on its own: the app's transition commits, a person types from a
    // layout effect of that commit, and React runs the transition's passive effects only before it
    // commits the person's change.
    const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined };
    const before = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    const wait = () => new Promise((resolve) => { setTimeout(resolve, 5); });
    // React commits on its own clock, slower under a loaded machine: wait for what it shows, within bounds.
    const until = async (done: () => boolean) => {
      for (let tries = 0; !done(); tries += 1) {
        if (tries === 400) throw new Error('React did not commit in time');
        await wait();
      }
    };
    try {
      const agent = createAgent();
      let appSets: (value: string) => void = () => {};
      function Owner() {
        const [color, setColor] = useState('#007aff');
        const typed = useRef(false);
        appSets = setColor;
        useLayoutEffect(() => {
          if (color !== '#222222' || typed.current) return;
          typed.current = true;
          const value = host.querySelector<HTMLInputElement>('[data-testid="first"] input[aria-label="Color value"]')!;
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(value, '#555555');
          value.dispatchEvent(new Event('input', { bubbles: true }));
        });
        return <><Picker agent={agent} name="first" color={color} onChange={setColor} /><Picker agent={agent} name="second" color={color} onChange={setColor} /></>;
      }
      root.render(<Owner />);
      await until(() => agent.snapshot().length === 2);
      const changes = recorder(agent);
      startTransition(() => { appSets('#222222'); });
      await until(() => changes.length >= 4);
      await wait();
      expect(sources(changes)).toEqual([
        ['first', '#222222', 'app'], ['second', '#222222', 'app'],
        ['first', '#555555', 'user'], ['second', '#555555', 'user'],
      ]);
    } finally {
      root.unmount();
      host.remove();
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = before;
    }
  });

  it('does not share a mark between pickers on different agents', async () => {
    const first = createAgent();
    const second = createAgent();
    render(<Shared first={first} second={second} />);
    const changes = recorder(first);
    const others = recorder(second);
    type('second', '#123456');
    await set(first, '#ff0000', 'first');
    expect(sources(changes)).toEqual([['first', '#123456', 'app'], ['first', '#ff0000', 'agent']]);
    expect(sources(others)).toEqual([['second', '#123456', 'user'], ['second', '#ff0000', 'app']]);
  });

  it('keeps the rule under StrictMode', async () => {
    const agent = createAgent();
    render(<StrictMode><Shared first={agent} /></StrictMode>);
    const changes = recorder(agent);
    type('second', '#123456');
    await set(agent, '#ff0000', 'first');
    fireEvent.click(screen.getByRole('button', { name: 'App sets blue' }));
    expect(sources(changes)).toEqual([
      ['first', '#123456', 'user'], ['second', '#123456', 'user'],
      ['first', '#ff0000', 'agent'], ['second', '#ff0000', 'agent'],
      ['first', '#336699', 'app'], ['second', '#336699', 'app'],
    ]);
  });
});
