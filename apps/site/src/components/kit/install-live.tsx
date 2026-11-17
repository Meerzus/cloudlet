'use client';

import { Check, Copy, Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { useCopy, usePageNotifications } from '@/components/site/notifications';
import { ColorPalette } from '@/components/ui/color-palette/color-palette';
import { ColorPicker } from '@/components/ui/color-picker/color-picker';
import { highlight } from '@/lib/highlight';
import { pageStill } from '@/lib/reduced-motion';
import {
  importLine,
  INSTALL_SNIPPETS,
  quoted,
  SNIPPET_KINDS,
  SNIPPET_START,
  snippetCode,
  type SnippetKind,
  type SnippetValues,
} from '@/lib/install-code';
import { COMPONENTS, registryUrlCommand, type RegistryItem } from '@/lib/site';
import { springEasing } from '@/lib/spring';
import { CommandButton, InstallCommand } from './install-command';

/** The kinds' glyphs, as the package draws them (16 px, stroked). */
const GLYPHS: Record<SnippetKind, string> = {
  success: 'M4.5 8.5 7 11l4.5-5.5',
  info: 'M8 7.5V11M8 5h.01',
  warning: 'M8 4.75V8.5M8 11.25h.01',
  error: 'm5.5 5.5 5 5m0-5-5 5',
};

/** The flight from the `<Toaster />` line to where the page's Toaster shows: critically damped, a little slow. */
const FLIGHT = springEasing({ stiffness: 170, damping: 26 });
/** The real notification is sent this far into the flight, so it lands as the ghost arrives. */
const HAND_OFF = 0.72;
/** How long the code's Copy shows its check. */
const COPIED_FOR = 1600;

/** Code as the site's code blocks highlight it. */
function Src({ children }: { children: string }) {
  const tokens = useMemo(() => highlight(children), [children]);
  return (
    <>
      {tokens.map((token, index) =>
        token.kind === 'plain' ? token.text : (
          <span key={index} className={`tok-${token.kind}`}>
            {token.text}
          </span>
        ),
      )}
    </>
  );
}

/** One line of code; `live` sits after it — the real component the line renders, or Run. */
function Line({ children, live, lineRef }: { children: ReactNode; live?: ReactNode; lineRef?: Ref<HTMLSpanElement> }) {
  return (
    <span ref={lineRef} className="ki-line">
      <span className="ki-src">{children}</span>
      {live ? <span className="ki-live">{live}</span> : null}
    </span>
  );
}

/**
 * A pill that flies from the `<Toaster />` line to where the page's Toaster shows (top centre on
 * wide screens, bottom on narrow ones, as the package's `auto` places it), then hands over to the
 * real notification.
 */
function fly(from: DOMRect, title: string, kind: SnippetKind, land: () => void) {
  const wide = window.matchMedia('(min-width: 48rem)').matches;
  const ghost = document.createElement('div');
  ghost.className = 'ki-pill';
  ghost.setAttribute('aria-hidden', 'true');
  const icon = document.createElement('span');
  icon.className = 'ki-pill-icon';
  icon.dataset['kind'] = kind;
  icon.innerHTML = `<svg viewBox="0 0 16 16"><path d="${GLYPHS[kind]}" /></svg>`;
  const text = document.createElement('span');
  text.textContent = title;
  ghost.append(icon, text);
  document.body.append(ghost);
  const box = ghost.getBoundingClientRect();
  const startX = from.left;
  const startY = from.top + from.height / 2 - box.height / 2;
  const endX = window.innerWidth / 2 - box.width / 2;
  const endY = wide ? 16 : window.innerHeight - 16 - box.height;
  const flight = ghost.animate(
    [
      { transform: `translate(${startX}px, ${startY}px) scale(0.6)`, opacity: 0 },
      { transform: `translate(${startX}px, ${startY}px) scale(0.85)`, opacity: 1, offset: 0.08 },
      { transform: `translate(${endX}px, ${endY}px) scale(1)`, opacity: 1 },
    ],
    { duration: FLIGHT.duration, easing: FLIGHT.easing, fill: 'forwards' },
  );
  const timer = window.setTimeout(land, FLIGHT.duration * HAND_OFF);
  void flight.finished
    .then(() => ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).finished)
    .catch(() => {})
    .finally(() => {
      window.clearTimeout(timer);
      ghost.remove();
    });
}

/**
 * The install section's live part: the command with the switch of the kit's components, the same
 * item by its address, and the lines that use the item — which run here. In the Toaster's code the
 * title is editable and Run (or Enter in the title) sends the notification out of the `<Toaster />`
 * line into the page's Island; after `<ColorPicker />` is the real picker, after `<ColorPalette />` the
 * real palette, and the code's values follow them. Nothing runs by itself.
 */
export function InstallLive() {
  const [item, setItem] = useState<RegistryItem>('toaster');
  const [values, setValues] = useState<SnippetValues>(SNIPPET_START);
  const [runs, setRuns] = useState(0);
  const [copied, setCopied] = useState(false);
  const controller = usePageNotifications();
  const copy = useCopy();
  const toasterLine = useRef<HTMLSpanElement>(null);
  const set = (change: Partial<SnippetValues>) => setValues((current) => ({ ...current, ...change }));
  const name = COMPONENTS.find((component) => component.id === item)?.name ?? item;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_FOR);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const run = () => {
    if (!controller) return;
    const spec = { title: values.title.trim() || SNIPPET_START.title, kind: values.kind };
    setRuns((count) => count + 1);
    const line = toasterLine.current?.querySelector('.ki-src');
    const still = pageStill() || typeof document.body.animate !== 'function';
    if (still || !line) {
      controller.show(spec);
      return;
    }
    fly(line.getBoundingClientRect(), spec.title, spec.kind, () => controller.show(spec));
  };

  const imports = (of: RegistryItem) =>
    INSTALL_SNIPPETS[of].imports.map((entry) => (
      <Line key={entry.from}>
        <Src>{importLine(entry)}</Src>
      </Line>
    ));

  const snippets: Record<RegistryItem, ReactNode> = {
    toaster: (
      <>
        {imports('toaster')}
        <span className="ki-gap" />
        <Line>
          <Src>{'const controller = createCloudlet();'}</Src>
        </Line>
        <Line lineRef={toasterLine}>
          <span key={runs} className={runs > 0 ? 'ki-flash' : undefined}>
            <Src>{'<Toaster controller={controller} />'}</Src>
          </span>
        </Line>
        <Line
          live={
            <button type="button" className="ki-run" onClick={run} disabled={!controller}>
              <Play className="ki-run-icon" aria-hidden="true" />
              Run
            </button>
          }
        >
          <Src>{'controller.show({ title: '}</Src>
          <span className="tok-string">
            &quot;
            <input
              className="ki-edit"
              value={values.title}
              size={Math.max(1, values.title.length)}
              maxLength={40}
              spellCheck={false}
              autoComplete="off"
              enterKeyHint="send"
              aria-label="Notification title. Enter runs the code"
              onChange={(event) => set({ title: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') run();
              }}
            />
            &quot;
          </span>
          <Src>{', kind: '}</Src>
          <button
            type="button"
            className="ki-edit ki-edit-kind tok-string"
            aria-label={`Kind: ${values.kind}. Change`}
            onClick={() => set({ kind: SNIPPET_KINDS[(SNIPPET_KINDS.indexOf(values.kind) + 1) % SNIPPET_KINDS.length]! })}
          >
            {quoted(values.kind)}
          </button>
          <Src>{' });'}</Src>
        </Line>
      </>
    ),
    'color-picker': (
      <>
        {imports('color-picker')}
        <span className="ki-gap" />
        <Line>
          <Src>{`const [accent, setAccent] = useState(${quoted(values.accent)});`}</Src>
        </Line>
        <Line live={<ColorPicker color={values.accent} onChange={(accent) => set({ accent })} labels={{ open: 'Change accent' }} />}>
          <Src>{'<ColorPicker color={accent} onChange={setAccent} />'}</Src>
        </Line>
      </>
    ),
    'color-palette': (
      <>
        {imports('color-palette')}
        <span className="ki-gap" />
        <Line>
          <Src>{`const [colors, setColors] = useState([${values.colors.map(quoted).join(', ')}]);`}</Src>
        </Line>
        <Line live={<ColorPalette colors={[...values.colors]} onChange={(colors) => set({ colors })} labels={{ group: 'Palette colors' }} />}>
          <Src>{'<ColorPalette colors={colors} onChange={setColors} />'}</Src>
        </Line>
      </>
    ),
  };

  return (
    <div className="ki-grid">
      <div className="ki-commands">
        <InstallCommand item={item} onItemChange={setItem} />
        <p key={item} className="ki-adds kit-swap">
          {INSTALL_SNIPPETS[item].adds}
        </p>
        <div className="ki-fallback">
          <p className="ki-note">
            If your CLI does not know the <code>@cloudlet</code> namespace, give it the item’s address:
          </p>
          <CommandButton command={registryUrlCommand(item)} className="ki-url" />
        </div>
      </div>

      <figure className="ki-code" aria-labelledby="ki-code-label">
        <figcaption className="ki-code-bar">
          <span id="ki-code-label" className="ki-code-label">
            Then, in your code — <span key={item} className="kit-swap">{name}</span>
          </span>
          <button type="button" className="ki-code-copy" onClick={async () => setCopied(await copy(snippetCode(item, values)))} aria-label={`Copy the ${name} code`}>
            {copied ? <Check className="ki-code-copy-icon" aria-hidden="true" /> : <Copy className="ki-code-copy-icon" aria-hidden="true" />}
            Copy
          </button>
        </figcaption>
        <div className="ki-snippets">
          {COMPONENTS.map((component) => (
            <pre key={component.id} className="ki-snippet" data-active={component.id === item ? '' : undefined} inert={component.id !== item}>
              <code>{snippets[component.id]}</code>
            </pre>
          ))}
        </div>
      </figure>
    </div>
  );
}
