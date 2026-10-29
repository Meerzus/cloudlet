'use client';

import { CloudletProvider, createCloudlet, Toaster, type ReactCloudletController } from '@cloudlet/toast';
import { Check, Copy, Link, RotateCcw } from 'lucide-react';
import { useEffect, useId, useInsertionEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { HexColorPicker } from 'react-colorful';
import { useCopy } from '@/components/site/notifications';
import { useTheme } from '@/components/site/theme';
import { DOCS_UI } from '@/lib/docs-ui-strings';
import { springEasing } from '@/lib/spring';
import { DEFAULT_STATE, FONT_STACKS, TOKENS, fromSearchParams, isDefault, toCss, toSearchParams, validate, type StyleEditorState, type Theme, type Token, type TokenShortName } from './model';

const UI = DOCS_UI.styleEditor;
const REGION_LABELS = { region: UI.region, island: UI.islandRegion };
/** The Island's own open spring (puppet-model SHAPE_OPEN): the swatch opens the way a pill does. */
const MORPH = springEasing({ stiffness: 900, damping: 60, mass: 2 });
const LABELS: Record<TokenShortName, string> = {
  background: 'Background',
  foreground: 'Foreground',
  muted: 'Muted',
  focus: 'Focus ring',
  'pill-height': 'Pill height',
  'pill-radius': 'Pill radius',
  'pill-max-width': 'Pill width',
  'island-radius': 'Island radius',
  'island-max-width': 'Island width',
  'font-family': 'Font',
  'font-size': 'Font size',
};
/** The radius slider's last stop stands for the package default, a full pill. */
const FULL_STOP = 33;
const SAMPLE = { kind: 'success', title: UI.sampleTitle } as const;
type ColorToken = Extract<Token, { control: 'color' }>;
type RangeToken = Extract<Token, { control: 'range' | 'radius' }>;
type PreviewRules = readonly [CSSStyleRule, CSSStyleRule];
type Controllers = { pill: ReactCloudletController; island: ReactCloudletController };

/** Replace only the editor's parameters, keeping other query values and the anchor. */
function replaceUrl(state: StyleEditorState) {
  const url = new URL(window.location.href);
  for (const token of TOKENS) {
    url.searchParams.delete(token.shortName);
    if (token.group === 'surface') url.searchParams.delete(`${token.shortName}-dark`);
  }
  for (const [key, value] of toSearchParams(state)) url.searchParams.append(key, value);
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function applyPreview([light, dark]: PreviewRules, state: StyleEditorState) {
  const apply = (rule: CSSStyleRule, token: Token, value: string, remove: boolean) => {
    if (remove || !validate(token.name, value)) rule.style.removeProperty(token.name);
    else rule.style.setProperty(token.name, token.control === 'font' && value === FONT_STACKS[1].value
      ? 'var(--font-inter), system-ui, sans-serif' : value);
  };
  for (const token of TOKENS) {
    if (token.group === 'surface') {
      const lightValue = state.light[token.shortName];
      const darkValue = state.dark[token.shortName];
      const lightDefault = isDefault(token.name, lightValue);
      apply(light, token, lightValue, lightDefault);
      // The light rule also outranks the package's dark rule: restore dark defaults.
      apply(dark, token, darkValue, lightDefault && isDefault(token.name, darkValue, 'dark'));
    } else {
      const value = token.group === 'shape' ? state.shape[token.shortName] : state.type[token.shortName];
      apply(light, token, value, isDefault(token.name, value));
      dark.style.removeProperty(token.name);
    }
  }
}

function valueOf(state: StyleEditorState, token: Token, theme: Theme): string {
  if (token.group === 'surface') return state[theme][token.shortName];
  return token.group === 'shape' ? state.shape[token.shortName] : state.type[token.shortName];
}

/** True for a moment after `trigger` turns it on; any change in `reset` turns it off. */
function useFlash(reset: unknown) {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(false), [reset]);
  useEffect(() => {
    if (!on) return;
    const timer = window.setTimeout(() => setOn(false), 1600);
    return () => window.clearTimeout(timer);
  }, [on]);
  return [on, setOn] as const;
}

/**
 * A theme builder on two live Toasters of its own: a pinned pill and an open Island, always
 * shown. Colors are edited for the site's theme; page notifications stay independent.
 */
export function StyleEditor() {
  const { resolved: theme } = useTheme();
  const [state, setState] = useState<StyleEditorState>(DEFAULT_STATE);
  const [controllers, setControllers] = useState<Controllers | null>(null);
  const pillZone = useRef<HTMLDivElement>(null);
  const islandZone = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [stage, setStage] = useState<HTMLElement | null>(null);
  const rules = useRef<PreviewRules | null>(null);
  const urlTimer = useRef<number | null>(null);
  const copy = useCopy({ toast: false });
  const css = toCss(state);
  const [copied, setCopied] = useFlash(css);
  const [linkCopied, setLinkCopied] = useFlash(state);

  useLayoutEffect(() => {
    setState(fromSearchParams(new URLSearchParams(window.location.search)));
  }, []);

  useEffect(() => {
    urlTimer.current = window.setTimeout(() => {
      urlTimer.current = null;
      replaceUrl(state);
    }, 150);
    return () => {
      if (urlTimer.current !== null) window.clearTimeout(urlTimer.current);
      urlTimer.current = null;
    };
  }, [state]);

  useEffect(() => {
    const pill = createCloudlet();
    const island = createCloudlet();
    let disposed = false;
    let timer: number | undefined;
    pill.show({ ...SAMPLE, id: 'style-editor-pill', attention: 'stack', duration: null });
    const showIsland = () => {
      island.show({
        ...SAMPLE,
        id: 'style-editor-island',
        description: { kind: 'text', text: UI.sampleDescription },
        action: { kind: 'command', label: UI.sampleAction, run: () => {} },
        attention: 'open',
        duration: null,
        // The Island is always there: closing it (×, swipe, Undo) brings it back.
        onClose: () => {
          if (!disposed) timer = window.setTimeout(showIsland, 900);
        },
      });
    };
    showIsland();
    setControllers({ pill, island });
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      pill.dispose();
      island.dispose();
    };
  }, []);

  useLayoutEffect(() => {
    // The stage is a same-origin about:blank frame: a real small viewport whose document never
    // sees presses on the controls, so the library's outside-press collapse leaves the Island open.
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    const copies = [...document.head.querySelectorAll('link[rel="stylesheet"], style')].map((node) => node.cloneNode(true) as Element);
    const preview = doc.createElement('style');
    doc.head.append(...copies, preview);
    const sheet = preview.sheet;
    if (!sheet) return;
    // After the copied package stylesheet and one class more specific than its own rules.
    sheet.insertRule('html .cloudlet-host {}', 0);
    sheet.insertRule('html .cloudlet-host[data-theme="dark"] {}', 1);
    rules.current = [sheet.cssRules[0] as CSSStyleRule, sheet.cssRules[1] as CSSStyleRule];
    applyPreview(rules.current, state);
    doc.documentElement.dataset.styleStage = '';
    setStage(doc.body);
    return () => {
      rules.current = null;
      for (const node of [...copies, preview]) node.remove();
      setStage(null);
    };
  }, []);

  useLayoutEffect(() => {
    // Fonts, the site palette and color-scheme come with the page's <html> classes; a scheme that
    // differed from the page's would paint the frame opaque.
    const root = frame.current?.contentDocument?.documentElement;
    if (!root || !stage) return;
    root.className = document.documentElement.className;
    root.style.colorScheme = theme;
  }, [stage, theme]);

  useInsertionEffect(() => {
    // The host measures SVG geometry in its layout lifecycle. Publish CSS first;
    // a radius change alone does not trigger its ResizeObserver afterward.
    if (rules.current) applyPreview(rules.current, state);
  }, [state]);

  const flushUrl = (next: StyleEditorState) => {
    if (urlTimer.current !== null) window.clearTimeout(urlTimer.current);
    urlTimer.current = null;
    replaceUrl(next);
  };

  const change = (token: Token, value: string) => {
    if (!validate(token.name, value)) return;
    setState((current) => {
      const group = token.group === 'surface' ? theme : token.group;
      return { ...current, [group]: { ...current[group], [token.shortName]: value.trim() } };
    });
  };

  const field = (token: Token) => {
    const value = valueOf(state, token, theme);
    const changed = !isDefault(token.name, value, token.group === 'surface' ? theme : 'light');
    const props = { label: LABELS[token.shortName], changed, onReset: () => change(token, token.defaults[token.group === 'surface' ? theme : 'light']) };
    if (token.control === 'color') return <ColorField key={`${token.name}-${theme}`} {...props} token={token} theme={theme} value={value} onChange={(next) => change(token, next)} />;
    if (token.control === 'font') return <FontField key={token.name} {...props} value={value} onChange={(next) => change(token, next)} />;
    return <RangeField key={token.name} {...props} token={token} value={value} onChange={(next) => change(token, next)} />;
  };

  return (
    <div className="docs-style-editor">
      <div className="docs-style-bar">
        <span className="docs-style-theme">{UI.themeNote[theme]}</span>
        <span className="docs-code-actions">
          <button type="button" className="docs-code-button" disabled={!css} onClick={() => { flushUrl(DEFAULT_STATE); setState(DEFAULT_STATE); }}>
            <RotateCcw className="size-3.5" aria-hidden="true" />{UI.reset}
          </button>
          <button type="button" className="docs-code-button" aria-label={linkCopied ? UI.copiedLink : UI.copyLink} onClick={async () => {
            flushUrl(state);
            setLinkCopied(await copy(window.location.href));
          }}>
            {linkCopied ? <Check className="size-3.5" aria-hidden="true" /> : <Link className="size-3.5" aria-hidden="true" />}
            {linkCopied ? DOCS_UI.copied : UI.copyLink}
          </button>
          <button type="button" className="docs-code-button" disabled={!css} aria-label={copied ? UI.copied : UI.copy} onClick={async () => setCopied(await copy(css))}>
            {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
            {copied ? DOCS_UI.copied : UI.copy}
          </button>
        </span>
      </div>
      <div className="docs-style-stage">
        <iframe ref={frame} className="docs-style-frame" title={UI.stage} />
        {stage ? createPortal(
          <>
            {/* A specimen of the collapsed shape; the Island below is the interactive one. */}
            <div ref={pillZone} className="docs-style-zone" data-zone="pill" inert>
              {controllers ? (
                <CloudletProvider controller={controllers.pill}>
                  <Toaster container={() => pillZone.current} position="top-center" theme={theme} labels={REGION_LABELS} />
                </CloudletProvider>
              ) : null}
            </div>
            <div ref={islandZone} className="docs-style-zone" data-zone="island">
              {controllers ? (
                <CloudletProvider controller={controllers.island}>
                  <Toaster container={() => islandZone.current} position="top-center" theme={theme} labels={REGION_LABELS} />
                </CloudletProvider>
              ) : null}
            </div>
          </>,
          stage,
        ) : null}
      </div>
      <div className="docs-style-controls">
        <fieldset>
          <legend>{UI.surface}</legend>
          <p className="docs-style-hint">{UI.colorsHint[theme]}</p>
          {TOKENS.filter((token) => token.group === 'surface').map(field)}
        </fieldset>
        <fieldset>
          <legend>{UI.shape}</legend>
          {TOKENS.filter((token) => token.group === 'shape').map(field)}
        </fieldset>
        <fieldset>
          <legend>{UI.type}</legend>
          {TOKENS.filter((token) => token.group === 'type').map(field)}
        </fieldset>
      </div>
      <div className="docs-style-code">
        <span className="docs-code-title">notifications.css</span>
        <pre className="docs-code-pre" tabIndex={0}><code>{css || UI.empty}</code></pre>
      </div>
    </div>
  );
}

type RowProps = { label: string; changed: boolean; onReset: () => void };

/**
 * Label · control · reset: the reset slot is always reserved so rows never shift. Fields repeat the
 * label as `aria-label` (same name): static audits cannot follow `htmlFor` into this component.
 */
function Row({ label, changed, onReset, htmlFor, children, error }: RowProps & { htmlFor?: string; children: ReactNode; error?: ReactNode }) {
  return (
    <div className="docs-style-row" data-changed={changed || undefined}>
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
      <div className="docs-style-control">{children}</div>
      <button type="button" className="docs-style-row-reset" hidden={!changed} aria-label={UI.resetToken(label)} onClick={onReset}>
        <RotateCcw className="size-3" aria-hidden="true" />
      </button>
      {error}
    </div>
  );
}

function hexSwatch(value: string): string | null {
  if (/^#[\da-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[\da-f]{3}$/i.test(value)) return `#${[...value.slice(1)].map((digit) => digit + digit).join('')}`.toLowerCase();
  return null;
}

/** Keeps a field's text while it is being typed, following outside changes (picker, reset). */
function useDraft(value: string) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft((current) => (current.trim() === value ? current : value)), [value]);
  return [draft, setDraft] as const;
}

function ColorField({ token, theme, value, onChange, ...row }: RowProps & { token: ColorToken; theme: Theme; value: string; onChange: (value: string) => void }) {
  const id = useId();
  const [draft, setDraft] = useDraft(value);
  // The picker only speaks hex: oklch(), var() and names keep the last hex the swatch had.
  const lastHex = useRef(hexSwatch(value) ?? token.defaults[theme]);
  const hex = hexSwatch(value);
  if (hex) lastHex.current = hex;
  const invalid = !validate(token.name, draft);
  return (
    <Row {...row} htmlFor={id} error={invalid ? <p id={`${id}-error`} className="docs-style-error">{UI.invalidColor}</p> : null}>
      <div className="docs-style-color">
        <ColorPicker label={row.label} color={lastHex.current} swatch={validate(token.name, value) ? value : lastHex.current} onChange={onChange} />
        <input id={id} type="text" aria-label={row.label} value={draft} spellCheck={false} autoComplete="off" aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined} onChange={(event) => {
          setDraft(event.target.value);
          if (validate(token.name, event.target.value)) onChange(event.target.value);
        }} />
      </div>
    </Row>
  );
}

type Phase = 'closed' | 'open' | 'closing';

/**
 * The swatch morphs into the picker: the panel's clip grows out of the swatch circle on the
 * Island's spring while the circle stays put, and shrinks back into it on close.
 */
function ColorPicker({ label, color, swatch, onChange }: { label: string; color: string; swatch: string; onChange: (value: string) => void }) {
  const panelId = useId();
  const [phase, setPhase] = useState<Phase>('closed');
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const running = useRef<Animation[]>([]);

  const close = (refocus: boolean) => {
    setPhase((current) => (current === 'open' ? 'closing' : current));
    if (refocus) trigger.current?.focus();
  };

  useLayoutEffect(() => {
    const element = panel.current;
    const circle = handle.current;
    if (phase === 'closed' || !element || !circle) return;
    for (const animation of running.current) animation.cancel();
    running.current = [];
    if (phase === 'open') element.querySelector<HTMLElement>('.react-colorful__interactive')?.focus({ preventScroll: true });
    if (typeof element.animate !== 'function' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      if (phase === 'closing') setPhase('closed');
      return;
    }
    const box = element.getBoundingClientRect();
    const dot = circle.getBoundingClientRect();
    const top = dot.top - box.top;
    const left = dot.left - box.left;
    const collapsed = `inset(${top}px ${box.right - dot.right}px ${box.bottom - dot.bottom}px ${left}px round ${dot.width / 2}px)`;
    const expanded = 'inset(0px 0px 0px 0px round 1.25rem)';
    const content = body.current;
    if (phase === 'open') {
      running.current = [
        element.animate({ clipPath: [collapsed, expanded] }, { duration: MORPH.duration, easing: MORPH.easing }),
        ...(content ? [content.animate({ opacity: [0, 1], filter: ['blur(6px)', 'blur(0px)'] }, { duration: 240, delay: 70, easing: 'ease-out', fill: 'backwards' })] : []),
      ];
      return;
    }
    const shrink = element.animate({ clipPath: [expanded, collapsed] }, { duration: 240, easing: 'cubic-bezier(0.3, 0, 0.2, 1)', fill: 'forwards' });
    running.current = [shrink, ...(content ? [content.animate({ opacity: [1, 0], filter: ['blur(0px)', 'blur(6px)'] }, { duration: 140, easing: 'ease-in', fill: 'forwards' })] : [])];
    shrink.finished.then(() => setPhase('closed'), () => {});
  }, [phase]);

  useEffect(() => {
    if (phase !== 'open') return;
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [phase]);

  const style = { '--docs-style-swatch': swatch } as CSSProperties;
  return (
    <div className="docs-style-picker" style={style}>
      <button ref={trigger} type="button" className="docs-style-swatch" aria-label={UI.openPicker(label)} aria-expanded={phase === 'open'} aria-controls={phase === 'closed' ? undefined : panelId} onClick={() => setPhase('open')} />
      {phase === 'closed' ? null : (
        // The drop shadow sits on a wrapper: the panel's own clip-path would cut it off.
        <div className="docs-style-picker-shadow">
          <div ref={panel} id={panelId} role="dialog" aria-label={UI.picker(label)} className="docs-style-picker-panel" data-phase={phase} onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              close(true);
            }
          }}>
            <div className="docs-style-picker-head">
              <button ref={handle} type="button" className="docs-style-swatch" aria-label={UI.closePicker} onClick={() => close(true)} />
              <span className="docs-style-picker-value">{color}</span>
            </div>
            <div ref={body}>
              <HexColorPicker color={color} onChange={onChange} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RangeField({ token, value, onChange, ...row }: RowProps & { token: RangeToken; value: string; onChange: (value: string) => void }) {
  const id = useId();
  const full = token.control === 'radius' && isDefault(token.name, value);
  const number = isDefault(token.name, value) ? token.defaultNumber : parseFloat(value);
  const unit = token.unit;
  const fits = full || isDefault(token.name, value) || (
    value.trim().toLowerCase().endsWith(unit) && Number(value.trim().slice(0, -unit.length)) === number &&
    Number.isInteger(number) && number >= token.min && number <= token.max
  );
  const shown = full ? UI.full : String(number);
  const [draft, setDraft] = useDraft(fits ? shown : value);
  if (!fits) {
    // URL values may use any validated CSS unit or var(), beyond what the slider can show.
    const invalid = !validate(token.name, draft);
    return (
      <Row {...row} htmlFor={id} error={invalid ? <p id={`${id}-error`} className="docs-style-error">{UI.invalidLength}</p> : null}>
        <input id={id} type="text" aria-label={row.label} className="docs-style-wide" value={draft} spellCheck={false} autoComplete="off" aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined} onChange={(event) => {
          setDraft(event.target.value);
          if (validate(token.name, event.target.value)) onChange(event.target.value.trim());
        }} />
      </Row>
    );
  }
  const max = token.control === 'radius' ? FULL_STOP : token.max;
  const position = full ? FULL_STOP : number;
  const commit = (next: number) => onChange(token.control === 'radius' && next >= FULL_STOP ? token.defaults.light : `${next}${unit}`);
  const parsed = draft.trim().toLowerCase() === UI.full.toLowerCase() && token.control === 'radius' ? FULL_STOP : Number(draft);
  const valid = draft.trim() !== '' && Number.isInteger(parsed) && parsed >= token.min && parsed <= max;
  const fill = `${((position - token.min) / (max - token.min)) * 100}%`;
  return (
    <Row {...row} htmlFor={id} error={valid ? null : <p id={`${id}-error`} className="docs-style-error">{UI.rangeError(token.min, token.max, unit)}</p>}>
      <input id={id} type="range" aria-label={row.label} min={token.min} max={max} step={token.step} value={position} style={{ '--docs-style-progress': fill } as CSSProperties}
        aria-valuetext={full ? UI.full : `${number}${unit}`} onChange={(event) => commit(Number(event.target.value))} />
      <span className="docs-style-value">
        <input type="text" inputMode="numeric" value={draft} spellCheck={false} autoComplete="off" aria-label={UI.value(row.label)} aria-invalid={!valid || undefined} aria-describedby={valid ? undefined : `${id}-error`} onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const numeric = next.trim().toLowerCase() === UI.full.toLowerCase() && token.control === 'radius' ? FULL_STOP : Number(next);
          if (next.trim() && Number.isInteger(numeric) && numeric >= token.min && numeric <= max) commit(numeric);
        }} />
        <span aria-hidden="true">{full ? '' : unit}</span>
      </span>
    </Row>
  );
}

function FontField({ value, onChange, ...row }: RowProps & { value: string; onChange: (value: string) => void }) {
  const id = useId();
  const [custom, setCustom] = useState(!FONT_STACKS.some((stack) => stack.value === value));
  const [draft, setDraft] = useDraft(value);
  useEffect(() => {
    // URL, reset and typed values pick the matching preset, or Custom for anything else.
    setCustom(!FONT_STACKS.some((stack) => stack.value === value));
  }, [value]);
  const invalid = custom && !validate('--cloudlet-font-family', draft);
  return (
    <Row {...row} htmlFor={id} error={invalid ? <p id={`${id}-error`} className="docs-style-error">{UI.invalidFont}</p> : null}>
      <select id={id} aria-label={row.label} className="docs-style-wide" value={custom ? 'custom' : value} onChange={(event) => {
        const next = event.target.value;
        setCustom(next === 'custom');
        setDraft(next === 'custom' ? value : next);
        if (next !== 'custom') onChange(next);
      }}>
        {FONT_STACKS.map((stack) => <option key={stack.label} value={stack.value}>{stack.label}</option>)}
        <option value="custom">{UI.custom}</option>
      </select>
      {custom ? <input className="docs-style-wide docs-style-custom" type="text" value={draft} spellCheck={false} autoComplete="off" aria-label={UI.customFont} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined} onChange={(event) => {
        setDraft(event.target.value);
        if (validate('--cloudlet-font-family', event.target.value)) onChange(event.target.value);
      }} /> : null}
    </Row>
  );
}
