import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STATE,
  FONT_STACKS,
  TOKENS,
  changedTokens,
  fromSearchParams,
  isDefault,
  toCss,
  toSearchParams,
  validate,
  type StyleEditorState,
} from '../../apps/site/src/components/docs/style-editor/model';

const css = readFileSync(new URL('../../packages/toast/src/styles.css', import.meta.url), 'utf8');

/** First rule with this selector, as in site-puppet.test.ts. */
function tokens(selector: string) {
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--cloudlet-[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value!.trim()]));
}

const fresh = (): StyleEditorState => structuredClone(DEFAULT_STATE);

afterEach(() => vi.unstubAllGlobals());

describe('style editor: token defaults', () => {
  it('defines exactly the eleven controls, in the specification order', () => {
    expect(TOKENS.map(({ shortName }) => shortName)).toEqual([
      'background', 'foreground', 'muted', 'focus', 'pill-height', 'pill-radius', 'pill-max-width',
      'island-radius', 'island-max-width', 'font-family', 'font-size',
    ]);
    expect(TOKENS.map(({ name, shortName }) => name === `--cloudlet-${shortName}`)).toEqual(Array(11).fill(true));
    expect(TOKENS.filter(({ group }) => group === 'surface')).toHaveLength(4);
    expect(TOKENS.filter(({ group }) => group === 'shape')).toHaveLength(5);
    expect(TOKENS.filter(({ group }) => group === 'type')).toHaveLength(2);
  });

  it('matches both package themes and every default-state value', () => {
    const light = tokens('.cloudlet-host {');
    const dark = tokens('.cloudlet-host[data-theme="dark"] {');
    for (const token of TOKENS) {
      expect(token.defaults.light, token.name).toBe(light[token.name]);
      expect(token.defaults.dark, token.name).toBe(token.group === 'surface' ? dark[token.name] : light[token.name]);
      if (token.group === 'surface') {
        expect(DEFAULT_STATE.light[token.shortName]).toBe(token.defaults.light);
        expect(DEFAULT_STATE.dark[token.shortName]).toBe(token.defaults.dark);
      } else if (token.group === 'shape') expect(DEFAULT_STATE.shape[token.shortName]).toBe(token.defaults.light);
      else expect(DEFAULT_STATE.type[token.shortName]).toBe(token.defaults.light);
    }
  });

  it('keeps the px slider default equivalent to the package rem font size', () => {
    const state = fresh();
    state.type['font-size'] = '14px';
    expect(isDefault('--cloudlet-font-size', '14px')).toBe(true);
    expect(isDefault('--cloudlet-font-size', '.875rem')).toBe(true);
    expect(isDefault('--cloudlet-font-size', '16px')).toBe(false);
    expect(toCss(state)).toBe('');
    expect(state.type['font-size']).toBe('14px');
  });

  it('compares surface defaults with the requested theme', () => {
    expect(isDefault('--cloudlet-background', '#1c1c1e', 'dark')).toBe(true);
    expect(isDefault('--cloudlet-background', '#1c1c1e')).toBe(false);
    expect(isDefault('--cloudlet-unknown', '0')).toBe(false);
  });
});

describe('style editor: URL state', () => {
  it('round-trips both surface themes and shared tokens', () => {
    const state: StyleEditorState = {
      light: { background: '#f4f1ea', foreground: '#25211d', muted: 'oklch(.5 .02 70)', focus: 'var(--accent)' },
      dark: { background: '#14110c', foreground: '#f8f0df', muted: '#b0a896', focus: 'rgb(120 160 240 / 90%)' },
      shape: { 'pill-height': '48px', 'pill-radius': '12px', 'pill-max-width': '24rem', 'island-radius': '18px', 'island-max-width': '30rem' },
      type: { 'font-family': FONT_STACKS[2].value, 'font-size': '16px' },
    };
    // Parse the encoded query as a new URL would, including spaces, commas and #.
    expect(fromSearchParams(new URLSearchParams(toSearchParams(state).toString()))).toEqual(state);
  });

  it('omits defaults, including the equivalent px font-size default', () => {
    expect(toSearchParams(DEFAULT_STATE).toString()).toBe('');
    const state = fresh();
    state.type['font-size'] = '14px';
    expect(toSearchParams(state).toString()).toBe('');
    expect(fromSearchParams(new URLSearchParams())).toEqual(DEFAULT_STATE);
  });

  it('serializes changes in table order with dark surfaces next to their light value', () => {
    const state = fresh();
    state.type['font-size'] = '16px';
    state.type['font-family'] = FONT_STACKS[1].value;
    state.shape['pill-radius'] = '12px';
    state.dark.focus = '#99bbff';
    state.light.focus = '#245cdf';
    state.dark.background = '#14110c';
    state.light.background = '#f4f1ea';
    expect([...toSearchParams(state)]).toEqual([
      ['background', '#f4f1ea'], ['background-dark', '#14110c'],
      ['focus', '#245cdf'], ['focus-dark', '#99bbff'],
      ['pill-radius', '12px'], ['font-family', FONT_STACKS[1].value], ['font-size', '16px'],
    ]);
  });

  it('ignores unknown keys, dark suffixes on shared tokens and invalid values', () => {
    const params = new URLSearchParams([
      ['foo', '1'], ['--cloudlet-background', 'red'], ['pill-radius-dark', '12px'],
      ['background', 'red; color:blue'], ['background-dark', 'not-a-color'],
      ['foreground', '<script>'], ['foreground-dark', 'url(https://example.com)'],
      ['muted', 'x'.repeat(121)], ['focus', 'red\n'], ['pill-height', 'banana'],
      ['island-radius', '-12px'], ['font-family', "'Unclosed"], ['font-size', '16'],
      ['pill-radius', ' 12px '], ['focus-dark', ' #99bbff '], ['theme', 'system'],
    ]);
    const state = fromSearchParams(params);
    expect(state).toEqual({
      ...fresh(), dark: { ...DEFAULT_STATE.dark, focus: '#99bbff' },
      shape: { ...DEFAULT_STATE.shape, 'pill-radius': '12px' },
    });
  });

  it('validates URL values with the same browser validation used by the controls', () => {
    const supports = vi.fn(() => false);
    vi.stubGlobal('CSS', { supports });
    const state = fromSearchParams(new URLSearchParams('pill-radius=12px'));
    expect(state).toEqual(DEFAULT_STATE);
    expect(supports).toHaveBeenCalledWith('height', '12px');
  });

  it('ignores the retired theme parameter: the site theme picks the preview', () => {
    expect(fromSearchParams(new URLSearchParams('theme=dark'))).toEqual(DEFAULT_STATE);
    expect(fromSearchParams(new URLSearchParams('theme=dark'))).not.toHaveProperty('theme');
  });

  it('extends a supplied base without sharing or mutating its groups', () => {
    const base = fresh();
    base.light.background = 'beige';
    base.dark.background = '#14110c';
    base.shape['pill-radius'] = '20px';
    base.type['font-family'] = FONT_STACKS[3].value;
    const before = structuredClone(base);
    const state = fromSearchParams(new URLSearchParams('pill-radius=12px&background-dark=invalid'), base);
    expect(state).toEqual({ ...base, shape: { ...base.shape, 'pill-radius': '12px' } });
    expect(base).toEqual(before);
    for (const group of ['light', 'dark', 'shape', 'type'] as const) expect(state[group]).not.toBe(base[group]);
    expect(fromSearchParams(new URLSearchParams())).toEqual(DEFAULT_STATE);
  });
});

describe('style editor: validation without CSS.supports', () => {
  it.each([
    '#fff', '#ffff', '#f4f1ea', '#f4f1ea88', 'red', 'transparent', 'currentColor',
    'rgb(12, 30, 40)', 'rgba(12, 30, 40, .5)', 'rgb(12 30 40 / 50%)',
    'hsl(120, 40%, 50%)', 'hsl(120deg 40% 50% / .5)', 'oklch(0.7 0.17 160)',
    'oklab(.7 .1 -.2)', 'color(display-p3 1 0 .4)', 'var(--surface)', 'var(--surface, #fff)',
  ])('accepts color %s', (value) => expect(validate('--cloudlet-background', value)).toBe(true));

  it.each(['#ff', '#fffff', '#ggg', 'nonsense', 'oklch(nope)', 'rgb()', 'rgb(1 2)', 'var(foo)', 'var(--surface) other'])('rejects color %s', (value) => {
    expect(validate('--cloudlet-background', value)).toBe(false);
  });

  it.each(['0', '12px', '22rem', '.875rem', '50%', '2em', '10dvh', 'var(--radius)'])('accepts dimension %s', (value) => {
    expect(validate('--cloudlet-pill-height', value)).toBe(true);
    expect(validate('--cloudlet-island-max-width', value)).toBe(true);
    expect(validate('--cloudlet-font-size', value)).toBe(true);
  });

  it.each(['', '12', '-4px', 'NaNpx', 'Infinitypx', '12px nope', 'banana', 'var(radius)'])('rejects dimension %s', (value) => {
    expect(validate('--cloudlet-pill-radius', value)).toBe(false);
  });

  it('accepts preset and custom font families', () => {
    for (const { value } of FONT_STACKS) expect(validate('--cloudlet-font-family', value)).toBe(true);
    for (const value of ['Arial, sans-serif', '"My font", serif', 'var(--font-inter)']) expect(validate('--cloudlet-font-family', value)).toBe(true);
    for (const value of ['Arial,', "'Unclosed", 'font()', '123', 'Arial !important']) expect(validate('--cloudlet-font-family', value)).toBe(false);
  });

  it.each(['red; color:blue', 'red{', 'red}', '<script>', 'red\n', 'red\r', 'red\t', 'url(https://example.com)', 'URL (x)', 'expression(alert(1))', 'Expression (x)', 'x'.repeat(121)])('rejects unsafe input before browser validation: %j', (value) => {
    const supports = vi.fn(() => true);
    vi.stubGlobal('CSS', { supports });
    expect(validate('--cloudlet-background', value)).toBe(false);
    expect(supports).not.toHaveBeenCalled();
  });

  it('delegates to CSS.supports with the property associated with each token', () => {
    const supports = vi.fn(() => true);
    vi.stubGlobal('CSS', { supports });
    for (const token of TOKENS) {
      expect(validate(token.name, ' custom browser value ')).toBe(true);
      expect(supports).toHaveBeenLastCalledWith(token.property, 'custom browser value');
    }
    supports.mockReturnValue(false);
    expect(validate('--cloudlet-background', '#fff')).toBe(false);
    expect(validate('--cloudlet-unknown', '#fff')).toBe(false);
  });
});

describe('style editor: CSS export', () => {
  it('returns no CSS for the default state', () => {
    expect(changedTokens(DEFAULT_STATE)).toEqual([]);
    expect(toCss(DEFAULT_STATE)).toBe('');
  });

  it('exports light-only changes as the bare base rule, without comments', () => {
    const state = fresh();
    state.light.background = '#f4f1ea';
    expect(toCss(state)).toBe('.cloudlet-host {\n  --cloudlet-background: #f4f1ea;\n}');
  });

  it('exports dark-only changes for explicit and system dark, without an empty base rule', () => {
    const state = fresh();
    state.dark.background = '#14110c';
    expect(toCss(state)).toBe([
      "/* Dark colors: they must beat the package's dark rule */",
      '.cloudlet-host[data-theme="dark"] {',
      '  --cloudlet-background: #14110c;',
      '}',
      '@media (prefers-color-scheme: dark) {',
      '  .cloudlet-host[data-theme="system"] {',
      '    --cloudlet-background: #14110c;',
      '  }',
      '}',
    ].join('\n'));
  });

  it('exports mixed changes as two labelled blocks', () => {
    const state = fresh();
    state.light.background = '#f4f1ea';
    state.dark.background = '#14110c';
    state.shape['pill-radius'] = '12px';
    expect(toCss(state)).toBe([
      '/* Shape, type and light colors */',
      '.cloudlet-host {',
      '  --cloudlet-background: #f4f1ea;',
      '  --cloudlet-pill-radius: 12px;',
      '}',
      "/* Dark colors: they must beat the package's dark rule */",
      '.cloudlet-host[data-theme="dark"] {',
      '  --cloudlet-background: #14110c;',
      '}',
      '@media (prefers-color-scheme: dark) {',
      '  .cloudlet-host[data-theme="system"] {',
      '    --cloudlet-background: #14110c;',
      '  }',
      '}',
    ].join('\n'));
  });

  it('orders changes by the token table, independent of edit order', () => {
    const state = fresh();
    state.type['font-size'] = '16px';
    state.shape['island-radius'] = '12px';
    state.dark.foreground = 'white';
    state.dark.background = 'black';
    state.light.background = 'beige';
    expect(changedTokens(state)).toEqual([
      { name: '--cloudlet-background', value: 'beige', scope: 'light' },
      { name: '--cloudlet-background', value: 'black', scope: 'dark' },
      { name: '--cloudlet-foreground', value: 'white', scope: 'dark' },
      { name: '--cloudlet-island-radius', value: '12px', scope: 'shared' },
      { name: '--cloudlet-font-size', value: '16px', scope: 'shared' },
    ]);
  });

  it('includes the Inter loading note and portable stack, without the site font variable', () => {
    const state = fresh();
    state.type['font-family'] = FONT_STACKS[1].value;
    expect(toCss(state)).toBe("/* load Inter in your app */\n.cloudlet-host {\n  --cloudlet-font-family: 'Inter', system-ui, sans-serif;\n}");
    expect(toCss(state)).not.toContain('--font-inter');
  });

  it('excludes invalid values at the export boundary without mutating state', () => {
    const state = fresh();
    state.dark.background = 'red; color:blue';
    state.shape['pill-radius'] = '-12px';
    state.light.background = ' var(--surface) ';
    const before = structuredClone(state);
    expect(changedTokens(state)).toEqual([{ name: '--cloudlet-background', value: 'var(--surface)', scope: 'light' }]);
    expect(toCss(state)).toBe('.cloudlet-host {\n  --cloudlet-background: var(--surface);\n}');
    expect(state).toEqual(before);
  });
});
