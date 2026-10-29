/** Tokens shared by the controls, CSS export and URL state. No React or DOM. */
export type Theme = 'light' | 'dark';

type TokenDefinition = {
  name: `--cloudlet-${string}`;
  shortName: string;
  group: 'surface' | 'shape' | 'type';
  control: 'color' | 'range' | 'radius' | 'font';
  property: 'color' | 'height' | 'width' | 'font-family' | 'font-size';
  defaults: { light: string; dark: string };
  min?: number;
  max?: number;
  step?: number;
  unit?: 'px' | 'rem';
  defaultNumber?: number;
};

export const FONT_STACKS = [
  { label: 'System', value: 'system-ui, sans-serif' },
  { label: 'Inter', value: "'Inter', system-ui, sans-serif" },
  { label: 'Serif', value: "Georgia, 'Times New Roman', serif" },
  { label: 'Mono', value: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
] as const;

/** The order is the public token-table order, including when serializing changes. */
export const TOKENS = [
  { name: '--cloudlet-background', shortName: 'background', group: 'surface', control: 'color', property: 'color', defaults: { light: '#ffffff', dark: '#1c1c1e' } },
  { name: '--cloudlet-foreground', shortName: 'foreground', group: 'surface', control: 'color', property: 'color', defaults: { light: '#111113', dark: '#f5f5f7' } },
  { name: '--cloudlet-muted', shortName: 'muted', group: 'surface', control: 'color', property: 'color', defaults: { light: '#6e6e76', dark: '#a1a1aa' } },
  { name: '--cloudlet-focus', shortName: 'focus', group: 'surface', control: 'color', property: 'color', defaults: { light: '#245cdb', dark: '#93b4ff' } },
  { name: '--cloudlet-pill-height', shortName: 'pill-height', group: 'shape', control: 'range', property: 'height', defaults: { light: '44px', dark: '44px' }, min: 36, max: 64, step: 1, unit: 'px', defaultNumber: 44 },
  { name: '--cloudlet-pill-radius', shortName: 'pill-radius', group: 'shape', control: 'radius', property: 'height', defaults: { light: '9999px', dark: '9999px' }, min: 8, max: 32, step: 1, unit: 'px', defaultNumber: 9999 },
  { name: '--cloudlet-pill-max-width', shortName: 'pill-max-width', group: 'shape', control: 'range', property: 'width', defaults: { light: '22rem', dark: '22rem' }, min: 16, max: 32, step: 1, unit: 'rem', defaultNumber: 22 },
  { name: '--cloudlet-island-radius', shortName: 'island-radius', group: 'shape', control: 'range', property: 'height', defaults: { light: '24px', dark: '24px' }, min: 8, max: 40, step: 1, unit: 'px', defaultNumber: 24 },
  { name: '--cloudlet-island-max-width', shortName: 'island-max-width', group: 'shape', control: 'range', property: 'width', defaults: { light: '26rem', dark: '26rem' }, min: 20, max: 36, step: 1, unit: 'rem', defaultNumber: 26 },
  { name: '--cloudlet-font-family', shortName: 'font-family', group: 'type', control: 'font', property: 'font-family', defaults: { light: FONT_STACKS[0].value, dark: FONT_STACKS[0].value } },
  { name: '--cloudlet-font-size', shortName: 'font-size', group: 'type', control: 'range', property: 'font-size', defaults: { light: '.875rem', dark: '.875rem' }, min: 12, max: 18, step: 1, unit: 'px', defaultNumber: 14 },
] as const satisfies readonly TokenDefinition[];

export type Token = (typeof TOKENS)[number];
export type TokenName = Token['name'];
export type TokenShortName = Token['shortName'];
export type Surface = Record<Extract<Token, { group: 'surface' }>['shortName'], string>;
export type Shape = Record<Extract<Token, { group: 'shape' }>['shortName'], string>;
export type Type = Record<Extract<Token, { group: 'type' }>['shortName'], string>;
/** Surface colors are kept per theme; the site theme picks which set the controls edit. */
export type StyleEditorState = { light: Surface; dark: Surface; shape: Shape; type: Type };

export const DEFAULT_STATE: StyleEditorState = {
  light: { background: '#ffffff', foreground: '#111113', muted: '#6e6e76', focus: '#245cdb' },
  dark: { background: '#1c1c1e', foreground: '#f5f5f7', muted: '#a1a1aa', focus: '#93b4ff' },
  shape: { 'pill-height': '44px', 'pill-radius': '9999px', 'pill-max-width': '22rem', 'island-radius': '24px', 'island-max-width': '26rem' },
  type: { 'font-family': FONT_STACKS[0].value, 'font-size': '.875rem' },
};

const BY_NAME = new Map<string, Token>(TOKENS.map((token) => [token.name, token]));
const UNSAFE = /[\u0000-\u001f\u007f;{}<>]|(?:url|expression)\s*\(/i;
const NUMBER = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`;
const SIGNED_NUMBER = String.raw`[+-]?${NUMBER}`;
const CUSTOM_PROPERTY = String.raw`--[a-zA-Z_][\w-]*`;
const VARIABLE = new RegExp(String.raw`^var\(\s*${CUSTOM_PROPERTY}\s*(?:,\s*[^()]+)?\)$`, 'i');
const LENGTH = new RegExp(String.raw`^(?:0|${NUMBER}(?:px|r?em|%|[sld]?v[wh]|vmin|vmax|ch|ex|cap|ic|lh|rlh|cm|mm|in|pt|pc|q))$`, 'i');
const CHANNEL = String.raw`${SIGNED_NUMBER}%?`;
const ALPHA = String.raw`(?:\s*\/\s*${CHANNEL})?`;
const RGB = new RegExp(String.raw`^rgba?\(\s*(?:${CHANNEL}\s*,\s*${CHANNEL}\s*,\s*${CHANNEL}(?:\s*,\s*${CHANNEL})?|${CHANNEL}\s+${CHANNEL}\s+${CHANNEL}${ALPHA})\s*\)$`, 'i');
const HUE = String.raw`${SIGNED_NUMBER}(?:deg|grad|rad|turn)?`;
const HSL = new RegExp(String.raw`^hsla?\(\s*(?:${HUE}\s*,\s*${NUMBER}%\s*,\s*${NUMBER}%(?:\s*,\s*${CHANNEL})?|${HUE}\s+${NUMBER}%\s+${NUMBER}%${ALPHA})\s*\)$`, 'i');
const PERCEPTUAL = new RegExp(String.raw`^(?:oklch|lch|oklab|lab)\(\s*${CHANNEL}\s+${CHANNEL}\s+${HUE}${ALPHA}\s*\)$`, 'i');
const COLOR_SPACE = new RegExp(String.raw`^color\(\s*(?:srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz(?:-d50|-d65)?)\s+${CHANNEL}\s+${CHANNEL}\s+${CHANNEL}${ALPHA}\s*\)$`, 'i');
const COLOR_NAMES = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato transparent turquoise violet wheat white whitesmoke yellow yellowgreen currentcolor').split(' '));

function fallbackColor(value: string): boolean {
  return /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value) || COLOR_NAMES.has(value.toLowerCase()) ||
    VARIABLE.test(value) || RGB.test(value) || HSL.test(value) || PERCEPTUAL.test(value) || COLOR_SPACE.test(value);
}

function fallbackFont(value: string): boolean {
  if (VARIABLE.test(value)) return true;
  return value.split(',').every((family) => /^(?:"[^"\n]+"|'[^'\n]+'|[a-zA-Z_][\w-]*(?:\s+[a-zA-Z_][\w-]*)*)$/.test(family.trim()));
}

/** The common trust boundary for controls, export and URL input. */
export function validate(name: string, value: string): boolean {
  const token = BY_NAME.get(name);
  if (!token || value.length > 120 || UNSAFE.test(value)) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (typeof globalThis.CSS?.supports === 'function') return globalThis.CSS.supports(token.property, trimmed);
  if (token.property === 'color') return fallbackColor(trimmed);
  if (token.property === 'font-family') return fallbackFont(trimmed);
  return LENGTH.test(trimmed) || VARIABLE.test(trimmed);
}

/** Slider font size is displayed in px; leaving it at 14 keeps the package's rem default. */
export function isDefault(name: string, value: string, theme: Theme = 'light'): boolean {
  const token = BY_NAME.get(name);
  if (!token) return false;
  const trimmed = value.trim();
  return trimmed === token.defaults[theme] || (name === '--cloudlet-font-size' && /^(?:14(?:\.0+)?px|0?\.875(?:0+)?rem)$/i.test(trimmed));
}

export type ChangedToken = { name: TokenName; value: string; scope: 'shared' | 'light' | 'dark' };

export function changedTokens(state: StyleEditorState): ChangedToken[] {
  const changes: ChangedToken[] = [];
  const append = (token: Token, value: string, scope: ChangedToken['scope']) => {
    const theme = scope === 'dark' ? 'dark' : 'light';
    if (validate(token.name, value) && !isDefault(token.name, value, theme)) changes.push({ name: token.name, value: value.trim(), scope });
  };
  for (const token of TOKENS) {
    if (token.group === 'surface') {
      append(token, state.light[token.shortName], 'light');
      append(token, state.dark[token.shortName], 'dark');
    } else if (token.group === 'shape') append(token, state.shape[token.shortName], 'shared');
    else append(token, state.type[token.shortName], 'shared');
  }
  return changes;
}

/** Only overrides are shared; the token-table order also defines the URL order. */
export function toSearchParams(state: StyleEditorState): URLSearchParams {
  const params = new URLSearchParams();
  for (const { name, value, scope } of changedTokens(state)) {
    params.set(`${name.slice('--cloudlet-'.length)}${scope === 'dark' ? '-dark' : ''}`, value);
  }
  return params;
}

/** Unknown keys and invalid values never reach either CSSOM or the CSS export. */
export function fromSearchParams(params: URLSearchParams, base: StyleEditorState = DEFAULT_STATE): StyleEditorState {
  const state: StyleEditorState = {
    light: { ...base.light },
    dark: { ...base.dark },
    shape: { ...base.shape },
    type: { ...base.type },
  };
  for (const token of TOKENS) {
    if (token.group === 'surface') {
      for (const theme of ['light', 'dark'] as const) {
        const value = params.get(`${token.shortName}${theme === 'dark' ? '-dark' : ''}`);
        if (value !== null && validate(token.name, value)) state[theme][token.shortName] = value.trim();
      }
    } else {
      const value = params.get(token.shortName);
      if (value === null || !validate(token.name, value)) continue;
      if (token.group === 'shape') state.shape[token.shortName] = value.trim();
      else state.type[token.shortName] = value.trim();
    }
  }
  return state;
}

export function toCss(state: StyleEditorState): string {
  const changes = changedTokens(state);
  if (!changes.length) return '';
  const light = changes.filter(({ scope }) => scope !== 'dark');
  const dark = changes.filter(({ scope }) => scope === 'dark');
  const declarations = (tokens: ChangedToken[], indent: string) => tokens.map(({ name, value }) => `${indent}${name}: ${value};`).join('\n');
  const blocks: string[] = [];
  if (changes.some(({ name, value }) => name === '--cloudlet-font-family' && value === FONT_STACKS[1].value)) blocks.push('/* load Inter in your app */');
  if (light.length) blocks.push(`${dark.length ? '/* Shape, type and light colors */\n' : ''}.cloudlet-host {\n${declarations(light, '  ')}\n}`);
  if (dark.length) {
    blocks.push(`/* Dark colors: they must beat the package's dark rule */\n.cloudlet-host[data-theme="dark"] {\n${declarations(dark, '  ')}\n}`);
    blocks.push(`@media (prefers-color-scheme: dark) {\n  .cloudlet-host[data-theme="system"] {\n${declarations(dark, '    ')}\n  }\n}`);
  }
  return blocks.join('\n');
}
