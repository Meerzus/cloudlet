'use client';

import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { COLOR_FORMATS, detectFormat, formatHsva, parseToHsva, type ColorFormat, type Hsva } from './color';
import type { ColorPickerPanelProps, ColorPickerProps } from './color-picker';

// The Color picker's side of the agent bridge (@cloudlet/agent). The picker never imports this file,
// so a page that does not call the hook ships none of it. The protocol is declared here
// structurally: this file compiles in a project without the bridge package, not even its types.
// The palette's adapter takes the shared parts from here.

// --- Protocol -----------------------------------------------------------------------------------

/**
 * One record of an agent snapshot, as the bridge reads it.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export type AgentEntryShape = {
  readonly ref: string;
  readonly component: string;
  readonly actions: readonly string[];
  readonly [key: string]: unknown;
};

/**
 * A cancellation signal as the bridge hands it out; an `AbortSignal` at runtime.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export interface AgentSignalShape {
  readonly aborted: boolean;
  readonly reason: unknown;
  readonly throwIfAborted: () => void;
  readonly addEventListener: (type: 'abort', listener: () => void, options?: { readonly once?: boolean }) => void;
  readonly removeEventListener: (type: 'abort', listener: () => void) => void;
}

/**
 * A value a step may return to the agent.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export type AgentValueShape = string | number | boolean | null | readonly AgentValueShape[] | { readonly [key: string]: AgentValueShape };

/**
 * What a step may do: on its own, with approval, or never.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export type AgentPermissionShape = 'allow' | 'confirm' | 'deny';

/**
 * A step as the bridge hands it to a component.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export interface AgentStepCallShape {
  readonly ref: string;
  readonly action: string;
  readonly args: readonly unknown[];
}

/**
 * How a person names what a step acts on, for the bridge's messages.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export interface AgentStepNamesShape {
  readonly target: string;
  readonly within?: string;
}

/**
 * A component's answer to the bridge's `check`.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export type AgentStepCheckShape =
  | { readonly available: true; readonly permission: AgentPermissionShape; readonly names?: AgentStepNamesShape }
  | { readonly available: false; readonly message?: string };

/**
 * What the bridge's `run` receives besides the step.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export interface AgentRunContextShape {
  readonly signal: AgentSignalShape;
  readonly approved: 'allow' | 'confirm';
}

/**
 * A component's answer to the bridge's `run`.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export type AgentRunOutcomeShape =
  | { readonly status: 'done'; readonly result?: AgentValueShape; readonly gone?: boolean }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'unavailable'; readonly message?: string }
  | { readonly status: 'stale' };

/**
 * A component's answer to the bridge's `summon`.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export type AgentSummonOutcomeShape = boolean | { readonly reached: boolean; readonly note: string };

/**
 * One change a component reports to the bridge's subscribers: what changed on which record and who
 * changed it.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export interface AgentChangeShape {
  readonly ref: string;
  readonly component: string;
  readonly label?: string;
  readonly key: string;
  readonly value: AgentValueShape;
  readonly previous: AgentValueShape;
  readonly reason?: string;
  readonly source: 'user' | 'agent' | 'app' | 'system';
}

/**
 * What a component hands to the bridge's `connect`. `check` and `run` come together, `summon` is
 * optional, and a read-only component leaves all three out.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export interface AgentComponentShape<Entry extends AgentEntryShape = AgentEntryShape> {
  readonly protocol: 1;
  readonly name: string;
  snapshot(): readonly Entry[];
  subscribe(listener: (changes?: readonly AgentChangeShape[]) => void): () => void;
  readonly check?: (step: AgentStepCallShape) => AgentStepCheckShape;
  readonly run?: (step: AgentStepCallShape, context: AgentRunContextShape) => AgentRunOutcomeShape | PromiseLike<AgentRunOutcomeShape>;
  readonly summon?: (step: AgentStepCallShape) => AgentSummonOutcomeShape;
}

/**
 * The bridge as the hooks take it: an agent made by `createAgent()` fits as is. Create it once,
 * outside render: a new object on every render connects the component again on every commit.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export interface AgentConnectorShape {
  readonly connect: (component: AgentComponentShape) => () => void;
}

/** Who made a change, as a change record names it. */
export type ChangeSourceShape = AgentChangeShape['source'];

// --- Shared parts -------------------------------------------------------------------------------

const freeze = Object.freeze;
const quote = JSON.stringify;
const EMPTY: readonly never[] = freeze([]);
const UNAVAILABLE: AgentRunOutcomeShape = freeze({ status: 'unavailable' });

/**
 * Messages the color adapters word themselves; the bridge words the rest from a record's `actions`.
 * Labels come from the app and values from the agent, so both are quoted.
 */
export const colorTexts = freeze({
  /** `"set" on "color-picker" takes a color.` — `what` names the arguments. */
  takes: (step: AgentStepCallShape, what: string) => `${quote(step.action)} on ${quote(step.ref)} takes ${what}.`,
  notColor: (input: string, label: string) => `${quote(input)} is not a color ${quote(label)} can read. Use hex, rgb(), hsl() or oklch().`,
  /** The app was handed `wanted` and the component still shows `shown`. */
  notTaken: (wanted: string, label: string, shown: string) => `The app did not take ${quote(wanted)}: ${quote(label)} is still ${quote(shown)}.`,
});

/** The picker's color when its string does not parse: white, as the picker itself falls back. */
const WHITE: Hsva = freeze({ h: 0, s: 0, v: 1, a: 1 });

/**
 * Reads a color the way the picker's value field does and writes it in `format`, without alpha when
 * the component has none, as typing it would. `null` when the picker cannot read it.
 */
export function writeColor(input: string, format: ColorFormat, alpha: boolean): string | null {
  const hsva = parseToHsva(input);
  return hsva ? formatHsva(alpha ? hsva : { ...hsva, a: 1 }, format) : null;
}

/**
 * Runs `write` and commits every React update it scheduled before returning, so a step reads what
 * the component shows after it. The bridge calls `run` from a queued promise, never while React
 * renders or commits, where `flushSync` could not flush. An app that sets the value later (after a
 * server answers, or in a transition) is seen as not having taken it.
 */
export function commitNow(write: () => void): void {
  flushSync(write);
}

/**
 * Who starts the change the next commit shows, for every color adapter on the same agent: a
 * component whose value changed in the commit that carries a person's or an agent's change names
 * the same author, even when the app hands the value to it through shared state. `mark` is called
 * right where the change starts and schedules a render of the adapter's component in the same
 * batch, so the commit that carries the change is the one that reads the mark. `settle` reads it
 * in that commit's layout effects; the mark is forgotten after the commit, whether or not a value
 * changed, so neither a mark the app ignored nor a value the app passes on in a later commit is
 * named after it. Adapters on different agents, or without one, never share a mark.
 */
export interface ChangeAuthor {
  readonly mark: (source: 'user' | 'agent') => void;
  /** The marked author of this commit, or `app` when nobody marked it. */
  readonly settle: () => ChangeSourceShape;
}

/** A mark and whether a commit has read it yet: only a read mark is forgotten. */
interface Mark {
  readonly source: 'user' | 'agent';
  read: boolean;
}

/** Where the adapters on one agent keep their mark. */
interface MarkSlot {
  current: Mark | null;
}

const marks = new WeakMap<AgentConnectorShape, MarkSlot>();

function slotOf(agent: AgentConnectorShape): MarkSlot {
  let slot = marks.get(agent);
  if (!slot) {
    slot = { current: null };
    marks.set(agent, slot);
  }
  return slot;
}

// Each adapter reads the mark in its own layout effect, in whatever order React runs them, so no
// read may forget it. It is forgotten in the passive effects of the commit that read it: the
// adapter that marked always renders in that commit, and React runs a commit's passive effects
// before it commits again, whichever microtasks come first. A mark set after the commit and before
// its passive effects has not been read yet, so it stays for the commit it belongs to.
export function useChangeAuthor(agent: AgentConnectorShape | null | undefined): ChangeAuthor {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const [own] = useState((): MarkSlot => ({ current: null }));
  const slot = agent ? slotOf(agent) : own;
  // The slot of the committed render: steps and handlers mark there.
  const committed = useRef(slot);
  const [state] = useState(() => {
    let last: Mark | null = null;
    const author: ChangeAuthor = freeze({
      mark(source: 'user' | 'agent') {
        last = { source, read: false };
        committed.current.current = last;
        rerender();
      },
      settle() {
        const mark = committed.current.current;
        if (!mark) return 'app';
        mark.read = true;
        return mark.source;
      },
    });
    return {
      author,
      // Unmounted in the commit that carries its own mark: that commit was the mark's, read or not.
      leave() {
        if (last && committed.current.current === last) last.read = true;
      },
      forget() {
        const held = committed.current;
        if (held.current?.read) held.current = null;
      },
    };
  });
  // Declared before the adapter's port, so `settle` reads this commit's slot.
  useLayoutEffect(() => { committed.current = slot; });
  useLayoutEffect(() => state.leave, [state]);
  useEffect(() => {
    state.forget();
    return state.forget;
  });
  return state.author;
}

/** What an adapter answers the bridge with: stable functions that read its committed state. */
export interface AgentPortMethods {
  readonly snapshot: () => readonly AgentEntryShape[];
  readonly check: (step: AgentStepCallShape) => AgentStepCheckShape;
  readonly run: (step: AgentStepCallShape, context: AgentRunContextShape) => AgentRunOutcomeShape | PromiseLike<AgentRunOutcomeShape>;
}

/**
 * Connects an adapter to `agent` as the component `name` while the calling component is mounted,
 * and again when either changes; nothing happens while `agent` is null or undefined. On every
 * commit, before connecting, it calls `commit`: the adapter reads what this commit shows and
 * returns `null` when the snapshot did not change, or the change records of this commit (an empty
 * array when nobody changed a value). The bridge then hears them in the same commit.
 *
 * Declared as one hook so the order holds: the adapter's state of a commit is in place before the
 * bridge first reads the snapshot. `methods` must be the same object for the component's life.
 *
 * @throws TypeError from `connect` for a name already connected: give a second component its own.
 */
export function useAgentPort(
  agent: AgentConnectorShape | null | undefined,
  name: string,
  methods: AgentPortMethods,
  commit: () => readonly AgentChangeShape[] | null,
): void {
  const [listeners] = useState(() => new Set<(changes?: readonly AgentChangeShape[]) => void>());
  useLayoutEffect(() => {
    const changes = commit();
    if (!changes) return;
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue;
      // A listener's error must not break React's commit or keep the others from hearing it.
      try { listener(changes); } catch (error) { queueMicrotask(() => { throw error; }); }
    }
  });
  useLayoutEffect(() => {
    if (!agent) return undefined;
    // The same function may subscribe twice; each subscription is removed on its own.
    const subscribe = (listener: (changes?: readonly AgentChangeShape[]) => void): (() => void) => {
      const own = (changes?: readonly AgentChangeShape[]): void => { listener(changes); };
      listeners.add(own);
      return () => { listeners.delete(own); };
    };
    return agent.connect(freeze({ protocol: 1 as const, name, snapshot: methods.snapshot, subscribe, check: methods.check, run: methods.run }));
  }, [agent, name, methods, listeners]);
}

// --- Color picker -------------------------------------------------------------------------------

/**
 * The picker's record in the agent snapshot.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export type ColorPickerEntry = {
  /** The component's name in the bridge: `color-picker` unless the app named it. */
  readonly ref: string;
  readonly component: 'color-picker';
  readonly actions: readonly ['set'];
  /** How a person names the picker: the `label` option, else `labels.open`. */
  readonly label: string;
  /** What the value field shows, written in `format`. */
  readonly value: string;
  readonly format: ColorFormat;
  readonly formats: readonly ColorFormat[];
  /** The picker keeps opacity; without it a color set by a step loses its alpha. */
  readonly alpha: boolean;
};

/** @experimental The protocol may change before the bridge reaches 1.0. */
export interface ColorPickerAgentOptions {
  /** The picker's name in the bridge, `[a-z][a-z0-9-]*`; default `color-picker`. A second picker on one agent needs its own. */
  readonly name?: string;
  /** How the agent's messages name the picker; default the picker's `labels.open`, else "Pick color". */
  readonly label?: string;
}

/**
 * What the picker shows, followed from the outside the way `usePickerState` keeps it: the color
 * prop is read again only when it is not the string the picker last emitted or read.
 */
interface Mirror {
  /** The picker's color; after an emitted value, the closest reading of that string. */
  readonly hsva: Hsva;
  /** Strings the picker emitted for this very color, by format: exact where a reading could round. */
  readonly texts: Partial<Record<ColorFormat, string>>;
  /** The color string the picker last emitted or read. */
  readonly source: string;
}

interface Committed {
  readonly entry: ColorPickerEntry;
  readonly entries: readonly ColorPickerEntry[];
  /** Hands a new value to whoever owns it, as the committed render's props say. */
  readonly write: (value: string) => void;
}

const ACTIONS: readonly ['set'] = freeze(['set'] as const);
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((item, index) => item === b[index]);

/**
 * Connects a `ColorPicker` or `ColorPickerPanel` to the agent bridge through its props:
 *
 * ```tsx
 * const accent = useColorPickerAgent(agent, { color, onChange: setColor }, { name: 'accent', label: 'Accent color' });
 * <ColorPicker {...accent} />
 * ```
 *
 * The picker appears in `agent.snapshot()` as one record (`ColorPickerEntry`), takes the step
 * `set [color]`, and reports each change of its value to `agent.subscribe` under the key `color`
 * with who started the change: `user` through the picker, `agent` through a step, `app` when the
 * app changed the prop itself. The author is shared by the color adapters on the same agent: a
 * picker or palette whose value changes in the same commit as the one a person or a step changed
 * names the same author, so two components on one state of the app report one source. A value the
 * app passes on in a later commit (from an effect, after a server answers) is named by that commit:
 * the app's, unless a person or a step changed something in it too. A picker without `color` (or
 * `format`) is uncontrolled: the hook holds the value (or the format) and hands the picker
 * controlled props. With `agent` null or undefined the props
 * come back as they are and nothing connects; keep the same agent for the component's life.
 *
 * A step answers by what the picker shows once React has committed the app's update: the value
 * that stood, or "The app did not take…" when nothing changed.
 *
 * @experimental The protocol may change before the bridge reaches 1.0.
 */
export function useColorPickerAgent<Props extends ColorPickerProps | ColorPickerPanelProps>(
  agent: AgentConnectorShape | null | undefined,
  props: Props,
  options: ColorPickerAgentOptions = {},
): Props {
  const { color, defaultColor, onChange, format, defaultFormat, onFormatChange, formats = COLOR_FORMATS, alpha = false, labels } = props;
  // The picker's own defaults, so an uncontrolled picker shows the same once the hook controls it.
  const [ownColor, setOwnColor] = useState(() => defaultColor ?? '');
  const [ownFormat, setOwnFormat] = useState<ColorFormat>(() => defaultFormat ?? formats[0] ?? 'hex');
  const author = useChangeAuthor(agent);
  const mirror = useRef<Mirror | null>(null);
  const committed = useRef<Committed | null>(null);
  // The picker emits once more right after switching the format: the same color in the new format.
  const switching = useRef(false);

  const shownColor = color ?? ownColor;
  const shownFormat = format ?? ownFormat;
  const name = options.name ?? 'color-picker';
  const label = options.label ?? labels?.open ?? 'Pick color';
  const strip = (hsva: Hsva): Hsva => (alpha ? hsva : { ...hsva, a: 1 });
  const write = (value: string): void => {
    if (color === undefined) setOwnColor(value);
    onChange?.(value);
  };

  const [methods] = useState((): AgentPortMethods => {
    type Plan =
      | { readonly ok: false; readonly message?: string }
      // `value` goes to the app; `lands` is what the picker shows once it reads `value` back, which
      // may differ (a gray loses its hue, a dark oklch() hue rounds anew).
      | { readonly ok: true; readonly value: string; readonly lands: string; readonly state: Committed };
    const plan = (step: AgentStepCallShape): Plan => {
      const state = committed.current;
      if (!state || step.ref !== state.entry.ref || step.action !== 'set') return { ok: false };
      const input = step.args[0];
      if (step.args.length !== 1 || typeof input !== 'string') return { ok: false, message: colorTexts.takes(step, 'a color') };
      const { format, alpha, label } = state.entry;
      const value = writeColor(input, format, alpha);
      if (value === null) return { ok: false, message: colorTexts.notColor(input, label) };
      return { ok: true, value, lands: writeColor(value, format, alpha) ?? value, state };
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
        const previous = verdict.state.entry.value;
        // The same color: nothing to hand the app, and nothing changed.
        if (verdict.value === previous || verdict.lands === previous) return freeze({ status: 'done', result: previous });
        commitNow(() => {
          author.mark('agent');
          verdict.state.write(verdict.value);
        });
        const now = committed.current;
        // The app unmounted the picker in answer to the change.
        if (!now) return freeze({ status: 'done', gone: true });
        const shown = now.entry.value;
        return shown !== previous
          ? freeze({ status: 'done', result: shown })
          : freeze({ status: 'failed', message: colorTexts.notTaken(verdict.value, now.entry.label, shown) });
      },
    });
  });

  // Reads this commit's props: the color the picker shows now, the record and, if the value
  // changed, who changed it. Never the latest props: a later render may not have committed yet.
  const commit = (): readonly AgentChangeShape[] | null => {
    if (!agent) {
      mirror.current = null;
      committed.current = null;
      author.settle();
      return null;
    }
    const known = mirror.current;
    let next: Mirror;
    if (!known) next = { hsva: strip(parseToHsva(shownColor) ?? WHITE), texts: {}, source: shownColor };
    else if (shownColor !== known.source) {
      // An unparsable string keeps the last valid color, as in the picker.
      const parsed = parseToHsva(shownColor);
      next = parsed ? { hsva: strip(parsed), texts: {}, source: shownColor } : { ...known, source: shownColor };
    } else next = known;
    mirror.current = next;
    const value = next.texts[shownFormat] ?? formatHsva(next.hsva, shownFormat);
    const source = author.settle();
    const before = committed.current;
    const old = before?.entry;
    const entry: ColorPickerEntry = old && old.ref === name && old.label === label && old.value === value && old.format === shownFormat
      && old.alpha === alpha && sameList(old.formats, formats)
      ? old
      : freeze({ ref: name, component: 'color-picker', actions: ACTIONS, label, value, format: shownFormat, formats: freeze([...formats]), alpha });
    committed.current = { entry, entries: before && entry === old ? before.entries : freeze([entry]), write };
    // The first commit is announced by connecting.
    if (!old || entry === old) return null;
    if (value === old.value) return EMPTY;
    return freeze([freeze({ ref: name, component: 'color-picker', label, key: 'color', value, previous: old.value, source })]);
  };

  useAgentPort(agent, name, methods, commit);
  // Unmounted (or, under StrictMode, about to mount again): a step in flight finds no picker.
  useLayoutEffect(() => () => { committed.current = null; }, []);

  if (!agent) return props;

  const handleChange = (value: string): void => {
    const known = mirror.current;
    if (known) {
      const parsed = parseToHsva(value);
      const written = detectFormat(value) ?? shownFormat;
      mirror.current = switching.current
        // The same color in another format: the picker's color did not move.
        ? { hsva: known.hsva, texts: { ...known.texts, [written]: value }, source: value }
        : { hsva: parsed ? strip(parsed) : known.hsva, texts: { [written]: value }, source: value };
    }
    switching.current = false;
    author.mark('user');
    write(value);
  };
  const handleFormatChange = (next: ColorFormat): void => {
    switching.current = true;
    if (format === undefined) setOwnFormat(next);
    onFormatChange?.(next);
  };

  return { ...props, color: shownColor, format: shownFormat, onChange: handleChange, onFormatChange: handleFormatChange };
}
