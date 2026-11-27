'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import {
  colorTexts, commitNow, useAgentPort, useChangeAuthor, writeColor, type AgentChangeShape, type AgentConnectorShape, type AgentPortMethods,
  type AgentRunOutcomeShape, type AgentStepCallShape, type AgentStepCheckShape,
} from '@/components/ui/color-picker/color-picker-agent';
import { COLOR_FORMATS, detectFormat, formatColor, parseColor, type ColorFormat } from '@/components/ui/color-picker/color';
import type { ColorPaletteProps } from './color-palette';

// The Color palette's side of the agent bridge (@cloudlet/agent). The palette never imports this
// file, so a page that does not call the hook ships none of it. The protocol and the connection
// come from the Color picker's adapter, which the palette installs anyway.

/** The palette's verbs; `add` and `remove` come and go with the number of colors. */
export type ColorPaletteAction = 'set' | 'add' | 'remove';

/**
 * The palette's record in the agent snapshot: the whole palette, since `onChange` names no color.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export type ColorPaletteEntry = {
  /** The component's name in the bridge: `color-palette` unless the app named it. */
  readonly ref: string;
  readonly component: 'color-palette';
  /** `set` always; `add` below `max`; `remove` with more than one color. */
  readonly actions: readonly ColorPaletteAction[];
  /** How a person names the palette: the `label` option, else `labels.group`. */
  readonly label: string;
  /** The colors as the palette shows them (its hidden fields under `name`), written in `format`; colors are counted from 0. */
  readonly colors: readonly string[];
  /** Most colors the palette holds. */
  readonly max: number;
  readonly format: ColorFormat;
  readonly formats: readonly ColorFormat[];
  /** The palette keeps opacity; without it a color set by a step loses its alpha. */
  readonly alpha: boolean;
};

/** @experimental The protocol may change before the bridge reaches 1.0. */
export interface ColorPaletteAgentOptions {
  /** The palette's name in the bridge, `[a-z][a-z0-9-]*`; default `color-palette`. A second palette on one agent needs its own. */
  readonly name?: string;
  /** How the agent's messages name the palette; default the palette's `labels.group`, else "Palette". */
  readonly label?: string;
}

const freeze = Object.freeze;
const quote = JSON.stringify;
const EMPTY: readonly never[] = freeze([]);
const UNAVAILABLE: AgentRunOutcomeShape = freeze({ status: 'unavailable' });
/** The palette's one color for an empty array. */
const DEFAULT_COLOR = '#ffffff';
const DEFAULT_MAX = 4;

/** Messages of the palette's own refusals; the shared ones come from `colorTexts`. */
const texts = freeze({
  noColor: (index: number, label: string, count: number) =>
    `There is no color ${index} in ${quote(label)}: it has ${count === 1 ? 'only color 0' : `colors 0–${count - 1}`}.`,
  full: (label: string, count: number) => `${quote(label)} already holds ${count} colors, its most.`,
  last: (label: string) => `${quote(label)} holds only one color, its least. Set it instead.`,
  notSet: (wanted: string, index: number, label: string, shown: string) =>
    `The app did not take ${quote(wanted)}: color ${index} of ${quote(label)} is still ${quote(shown)}.`,
  notAdded: (wanted: string, label: string, count: number) =>
    `The app did not take ${quote(wanted)}: ${quote(label)} still holds ${count === 1 ? '1 color' : `${count} colors`}.`,
  notRemoved: (index: number, label: string, count: number) =>
    `The app did not remove color ${index}: ${quote(label)} still holds ${count} colors.`,
});

/**
 * The color as the palette shows it: in `format`, alpha dropped unless the palette keeps it; a
 * string already in `format` stays as written, one that does not parse stays as it is. The same
 * rule as the palette's own, so the record matches its swatches and hidden fields.
 */
function reformat(color: string, format: ColorFormat, alpha: boolean): string {
  const rgba = parseColor(color);
  if (!rgba || (detectFormat(color) === format && (alpha || rgba.a >= 1))) return color;
  return formatColor(alpha ? rgba : { ...rgba, a: 1 }, format);
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((item, index) => item === b[index]);
const isIndex = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

interface Committed {
  readonly entry: ColorPaletteEntry;
  readonly entries: readonly ColorPaletteEntry[];
  /** Hands a new array to whoever owns it, as the committed render's props say. */
  readonly write: (colors: string[]) => void;
}

/**
 * Connects a `ColorPalette` to the agent bridge through its props:
 *
 * ```tsx
 * const brand = useColorPaletteAgent(agent, { colors, onChange: setColors }, { name: 'brand', label: 'Brand palette' });
 * <ColorPalette {...brand} />
 * ```
 *
 * The palette appears in `agent.snapshot()` as one record (`ColorPaletteEntry`) and takes the steps
 * `set [number, color]`, `add [color]` and `remove [number]`, numbers counted from 0; each answers
 * with the colors after it. Each change of the colors reaches `agent.subscribe` under the key
 * `colors` with who made it: `user` through the palette, `agent` through a step, `app` when the app
 * changed the prop itself. A palette without `colors` (or `format`) is uncontrolled: the hook holds
 * the colors (or the format) and hands the palette controlled props. With `agent` null or undefined
 * the props come back as they are and nothing connects; keep the same agent for the component's life.
 *
 * A step answers by what the palette shows once React has committed the app's update: the colors
 * that stood, or "The app did not take…" when nothing changed.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export function useColorPaletteAgent<Props extends ColorPaletteProps>(
  agent: AgentConnectorShape | null | undefined,
  props: Props,
  options: ColorPaletteAgentOptions = {},
): Props {
  const { colors, defaultColors, onChange, max = DEFAULT_MAX, format, defaultFormat, onFormatChange, formats = COLOR_FORMATS, alpha = false, labels } = props;
  // The palette's own defaults, so an uncontrolled palette shows the same once the hook controls it.
  const [ownColors, setOwnColors] = useState<readonly string[]>(() => defaultColors ?? []);
  const [ownFormat, setOwnFormat] = useState<ColorFormat>(() => defaultFormat ?? formats[0] ?? 'hex');
  const author = useChangeAuthor();
  const committed = useRef<Committed | null>(null);

  const givenColors = colors ?? ownColors;
  const shownFormat = format ?? ownFormat;
  const name = options.name ?? 'color-palette';
  const label = options.label ?? labels?.group ?? 'Palette';
  const write = (next: string[]): void => {
    if (colors === undefined) setOwnColors(next);
    onChange?.(next);
  };

  const [methods] = useState((): AgentPortMethods => {
    type Plan =
      | { readonly ok: false; readonly message?: string }
      | { readonly ok: true; readonly state: Committed; readonly next: readonly string[] | null; readonly fail: (now: ColorPaletteEntry) => string };
    const plan = (step: AgentStepCallShape): Plan => {
      const state = committed.current;
      if (!state || step.ref !== state.entry.ref) return { ok: false };
      const { colors: list, format, alpha, label, max } = state.entry;
      const { action, args } = step;
      const color = (input: string): string | Plan => writeColor(input, format, alpha) ?? { ok: false, message: colorTexts.notColor(input, label) };
      const place = (index: number): Plan | null => (index >= 0 && index < list.length ? null : { ok: false, message: texts.noColor(index, label, list.length) });
      if (action === 'set') {
        const [index, input] = args;
        if (args.length !== 2 || !isIndex(index) || typeof input !== 'string') return { ok: false, message: colorTexts.takes(step, 'the number of a color and a color') };
        const missing = place(index);
        if (missing) return missing;
        const value = color(input);
        if (typeof value !== 'string') return value;
        const current = list[index] ?? '';
        // The same color, even written otherwise: nothing to hand the app.
        const same = value === current || writeColor(current, format, alpha) === value;
        return {
          ok: true, state, next: same ? null : list.map((item, at) => (at === index ? value : item)),
          fail: (now) => texts.notSet(value, index, now.label, now.colors[index] ?? ''),
        };
      }
      if (action === 'add') {
        const [input] = args;
        if (args.length !== 1 || typeof input !== 'string') return { ok: false, message: colorTexts.takes(step, 'a color') };
        if (list.length >= max) return { ok: false, message: texts.full(label, list.length) };
        const value = color(input);
        if (typeof value !== 'string') return value;
        return { ok: true, state, next: [...list, value], fail: (now) => texts.notAdded(value, now.label, now.colors.length) };
      }
      if (action === 'remove') {
        const [index] = args;
        if (args.length !== 1 || !isIndex(index)) return { ok: false, message: colorTexts.takes(step, 'the number of a color') };
        const missing = place(index);
        if (missing) return missing;
        if (list.length <= 1) return { ok: false, message: texts.last(label) };
        return { ok: true, state, next: list.filter((_, at) => at !== index), fail: (now) => texts.notRemoved(index, now.label, now.colors.length) };
      }
      return { ok: false };
    };
    return freeze({
      snapshot: () => committed.current?.entries ?? EMPTY,
      check(step: AgentStepCallShape): AgentStepCheckShape {
        const verdict = plan(step);
        if (!verdict.ok) return freeze(verdict.message === undefined ? { available: false as const } : { available: false as const, message: verdict.message });
        return freeze({ available: true as const, permission: 'allow' as const, names: freeze({ target: verdict.state.entry.label }) });
      },
      // Read again from the committed state: props may have changed while the step waited.
      run(step: AgentStepCallShape): AgentRunOutcomeShape {
        const verdict = plan(step);
        if (!verdict.ok) return verdict.message === undefined ? UNAVAILABLE : freeze({ status: 'unavailable', message: verdict.message });
        const previous = verdict.state.entry.colors;
        if (!verdict.next) return freeze({ status: 'done', result: previous });
        const next = [...verdict.next];
        commitNow(() => {
          author.mark('agent');
          verdict.state.write(next);
        });
        const now = committed.current;
        // The app unmounted the palette in answer to the change.
        if (!now) return freeze({ status: 'done', gone: true });
        return sameList(now.entry.colors, previous)
          ? freeze({ status: 'failed', message: verdict.fail(now.entry) })
          : freeze({ status: 'done', result: now.entry.colors });
      },
    });
  });

  // Reads this commit's props: the colors the palette shows now, the record and, if the colors
  // changed, who changed them. Never the latest props: a later render may not have committed yet.
  const commit = (): readonly AgentChangeShape[] | null => {
    if (!agent) {
      committed.current = null;
      author.settle();
      return null;
    }
    const list = givenColors.length > 0 ? givenColors : [DEFAULT_COLOR];
    const shown = list.map((color) => reformat(color, shownFormat, alpha));
    const actions: ColorPaletteAction[] = ['set'];
    if (shown.length < max) actions.push('add');
    if (shown.length > 1) actions.push('remove');
    const source = author.settle();
    const before = committed.current;
    const old = before?.entry;
    const entry: ColorPaletteEntry = old && old.ref === name && old.label === label && sameList(old.colors, shown) && sameList(old.actions, actions)
      && old.max === max && old.format === shownFormat && old.alpha === alpha && sameList(old.formats, formats)
      ? old
      : freeze({
        ref: name, component: 'color-palette', actions: freeze(actions), label, colors: old && sameList(old.colors, shown) ? old.colors : freeze(shown),
        max, format: shownFormat, formats: freeze([...formats]), alpha,
      });
    committed.current = { entry, entries: before && entry === old ? before.entries : freeze([entry]), write };
    // The first commit is announced by connecting.
    if (!old || entry === old) return null;
    if (entry.colors === old.colors) return EMPTY;
    return freeze([freeze({ ref: name, component: 'color-palette', label, key: 'colors', value: entry.colors, previous: old.colors, source })]);
  };

  useAgentPort(agent, name, methods, commit);
  // Unmounted (or, under StrictMode, about to mount again): a step in flight finds no palette.
  useLayoutEffect(() => () => { committed.current = null; }, []);

  if (!agent) return props;

  const handleChange = (next: string[]): void => {
    author.mark('user');
    write(next);
  };
  const handleFormatChange = (next: ColorFormat): void => {
    if (format === undefined) setOwnFormat(next);
    onFormatChange?.(next);
  };

  return { ...props, colors: givenColors, format: shownFormat, onChange: handleChange, onFormatChange: handleFormatChange };
}
