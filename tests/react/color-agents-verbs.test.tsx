import { createAgent, type Agent } from '@cloudlet/agent';
import { act, render } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ColorPalette } from '@/components/ui/color-palette/color-palette';
import { COLOR_PALETTE_VERBS, useColorPaletteAgent } from '@/components/ui/color-palette/color-palette-agent';
import { ColorPickerPanel } from '@/components/ui/color-picker/color-picker';
import { COLOR_PICKER_VERBS, useColorPickerAgent } from '@/components/ui/color-picker/color-picker-agent';
import { verbsOf } from '../../packages/agent/src/verbs.js';

function Picker({ agent }: { agent: Agent }) {
  const [color, setColor] = useState('#007aff');
  return <ColorPickerPanel {...useColorPickerAgent(agent, { color, onChange: setColor })} />;
}

function Palette({ agent, initial }: { agent: Agent; initial: string[] }) {
  const [colors, setColors] = useState(initial);
  return <ColorPalette {...useColorPaletteAgent(agent, { colors, onChange: setColors, max: 3 })} />;
}

/** Every verb a record of the snapshot lists has a description in the agent's verbs. */
function expectEveryListedVerbDescribed(agent: Agent) {
  const described = verbsOf(agent);
  for (const entry of agent.snapshot()) {
    for (const verb of entry.actions) expect(described[entry.component]?.[verb], `${entry.component} ${verb}`).toEqual(expect.any(String));
  }
}

describe('color adapter verbs', () => {
  it('the picker describes set, with its one color argument', () => {
    expect(Object.keys(COLOR_PICKER_VERBS)).toEqual(['color-picker']);
    expect(Object.keys(COLOR_PICKER_VERBS['color-picker']!)).toEqual(['set']);
    expect(COLOR_PICKER_VERBS['color-picker']!.set).toMatch(/^args \[color\]/);
    expect(Object.isFrozen(COLOR_PICKER_VERBS['color-picker'])).toBe(true);
  });

  it('the palette describes set, add and remove, numbers counted from 0', () => {
    const verbs = COLOR_PALETTE_VERBS['color-palette']!;
    expect(Object.keys(COLOR_PALETTE_VERBS)).toEqual(['color-palette']);
    expect(Object.keys(verbs)).toEqual(['set', 'add', 'remove']);
    expect(verbs.set).toMatch(/^args \[index, color\]/);
    expect(verbs.add).toMatch(/^args \[color\]/);
    expect(verbs.remove).toMatch(/^args \[index\]/);
    expect(verbs.set).toMatch(/counted from 0/);
    expect(verbs.remove).toMatch(/counted from 0/);
  });

  it('reach the bridge through the hooks, which describe every verb the snapshot lists', async () => {
    const agent = createAgent();
    render(<><Picker agent={agent} /><Palette agent={agent} initial={['#ff0000', '#00ff00']} /></>);
    expect(verbsOf(agent)).toEqual({ ...COLOR_PICKER_VERBS, ...COLOR_PALETTE_VERBS });
    expect(agent.snapshot().find((entry) => entry.component === 'color-palette')?.actions).toEqual(['set', 'add', 'remove']);
    expectEveryListedVerbDescribed(agent);

    // At max the palette lists no add; its description stays.
    await act(() => agent.act({ steps: [{ ref: 'color-palette', action: 'add', args: ['#0000ff'] }] }));
    expect(agent.snapshot().find((entry) => entry.component === 'color-palette')?.actions).toEqual(['set', 'remove']);
    expectEveryListedVerbDescribed(agent);
  });

  it('leave the bridge with the component', () => {
    const agent = createAgent();
    const { unmount } = render(<Palette agent={agent} initial={['#ff0000']} />);
    expect(Object.keys(verbsOf(agent))).toEqual(['color-palette']);
    unmount();
    expect(verbsOf(agent)).toEqual({});
  });
});
