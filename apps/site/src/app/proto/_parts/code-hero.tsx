'use client';

import { Check, Copy, Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { useCopy, usePageNotifications } from '@/components/site/notifications';
import { ColorPalette } from '@/components/ui/color-palette/color-palette';
import { ColorPicker } from '@/components/ui/color-picker/color-picker';
import { parseColor, rgbToOklch } from '@/components/ui/color-picker/color';
import { highlight } from '@/lib/highlight';
import { COMPONENTS, REGISTRY_NAMESPACE, type RegistryItem } from '@/lib/site';
import { springEasing } from '@/lib/spring';
import { SloganSwitch, useSlogan } from './slogan-switch';

const KINDS = ['success', 'info', 'warning', 'error'] as const;
type Kind = (typeof KINDS)[number];

/** The kinds' glyphs, as the package draws them (16 px, stroked). */
const GLYPHS: Record<Kind, string> = {
  success: 'M4.5 8.5 7 11l4.5-5.5',
  info: 'M8 7.5V11M8 5h.01',
  warning: 'M8 4.75V8.5M8 11.25h.01',
  error: 'm5.5 5.5 5 5m0-5-5 5',
};

/** The flight from the `<Toaster />` line to where the Toaster lands: critically damped, a little slow. */
const FLIGHT = springEasing({ stiffness: 170, damping: 26 });
/** The real notification is sent this far into the flight, so it lands as the ghost arrives. */
const HAND_OFF = 0.72;
/** When the code runs by itself after load, unless the visitor got there first. */
const AUTO_RUN = 1600;

/** Static code, highlighted the way the site's Get started blocks are. */
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

function Line({ children, hint, className, lineRef }: { children: ReactNode; hint?: ReactNode; className?: string; lineRef?: Ref<HTMLDivElement> }) {
  return (
    <div ref={lineRef} className={`pc-line ${className ?? ''}`}>
      <code className="pc-src">{children}</code>
      {hint ? <span className="pc-hint">{hint}</span> : null}
    </div>
  );
}

/** Black or white text on a background color, by its OKLCH lightness. */
function inkOn(color: string) {
  const rgba = parseColor(color);
  return rgba && rgbToOklch(rgba).l > 0.68 ? 'oklch(0.2 0.02 260)' : 'oklch(0.99 0 0)';
}

/** A pill that flies from the `<Toaster />` line to the Toaster's spot, then hands over to the real notification. */
function fly(from: DOMRect, title: string, kind: Kind, land: () => void) {
  const wide = window.matchMedia('(min-width: 48rem)').matches;
  const ghost = document.createElement('div');
  ghost.className = 'proto-pill pc-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  const icon = document.createElement('span');
  icon.className = 'proto-pill-icon';
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
 * Prototype C, code comes alive: the first screen is the code you would write, and it runs here.
 * Run (or Enter in the title) sends the notification out of the `<Toaster />` line; the swatch after
 * `<ColorPicker />` is the real picker and opens out of the code; the palette is the real palette.
 * The values shown are the live props.
 */
export function CodeHero() {
  const { slogan, index, select } = useSlogan('c');
  const controller = usePageNotifications();
  const copy = useCopy();
  const [item, setItem] = useState<RegistryItem>('toaster');
  const [copied, setCopied] = useState(false);
  const [title, setTitle] = useState('Saved');
  const [kind, setKind] = useState<Kind>('success');
  const [accent, setAccent] = useState('#4c94db');
  const [colors, setColors] = useState<string[]>(['#4c94db', '#f5b83d', '#e5484d']);
  const [running, setRunning] = useState(0);
  const toasterLine = useRef<HTMLDivElement>(null);
  const command = `npx shadcn@latest add ${REGISTRY_NAMESPACE}/${item}`;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const run = () => {
    if (!controller) return;
    const spec = { title: title.trim() || 'Saved', kind };
    setRunning((count) => count + 1);
    const line = toasterLine.current?.querySelector('.pc-src');
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches || typeof document.body.animate !== 'function';
    if (still || !line) {
      controller.show(spec);
      return;
    }
    fly(line.getBoundingClientRect(), spec.title, spec.kind, () => controller.show(spec));
  };

  // Once, a moment after load, the code runs by itself: the first screen shows that it is alive.
  const latestRun = useRef(run);
  latestRun.current = run;
  const touched = useRef(false);
  useEffect(() => {
    if (!controller) return;
    const timer = window.setTimeout(() => {
      if (!touched.current) latestRun.current();
    }, AUTO_RUN);
    return () => window.clearTimeout(timer);
  }, [controller]);

  const style = { '--pc-accent': accent, '--pc-accent-ink': inkOn(accent) } as CSSProperties;

  return (
    <section aria-labelledby="proto-c-title" className="pc-hero" style={style} onPointerDownCapture={() => (touched.current = true)} onKeyDownCapture={() => (touched.current = true)}>
      <div className="pc-copy">
        <h1 id="proto-c-title" key={slogan.title} className="pc-title proto-swap">
          {slogan.title}
        </h1>
        <p key={slogan.lede} className="pc-lede proto-swap">
          {slogan.lede}
        </p>
      </div>

      <div className="pc-code" role="group" aria-label="Code you can run">
        <div className="pc-terminal">
          <div role="group" aria-label="Component to install" className="pc-tabs">
            {COMPONENTS.map((component) => (
              <button key={component.id} type="button" aria-pressed={component.id === item} onClick={() => setItem(component.id)}>
                {component.id}
              </button>
            ))}
          </div>
          <button type="button" className="pc-command" onClick={async () => setCopied(await copy(command))} aria-label={`Copy command: ${command}`}>
            <span aria-hidden="true" className="pc-prompt">
              $
            </span>
            <span className="pc-command-text">
              npx shadcn@latest add <span className="pc-command-item">{`${REGISTRY_NAMESPACE}/${item}`}</span>
            </span>
            <span aria-hidden="true" className="pc-command-copy">
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </span>
          </button>
        </div>

        <div className="pc-lines">
          <Line className="pc-import">
            <Src>{'import { Toaster } from "@/components/ui/toaster";'}</Src>
          </Line>
          <Line className="pc-import">
            <Src>{'import { ColorPicker } from "@/components/ui/color-picker/color-picker";'}</Src>
          </Line>
          <Line className="pc-import">
            <Src>{'import { ColorPalette } from "@/components/ui/color-palette/color-palette";'}</Src>
          </Line>
          <div className="pc-gap pc-import" />

          <Line lineRef={toasterLine} className="pc-toaster" key={`toaster-${running}`}>
            <Src>{'<Toaster controller={controller} />'}</Src>
          </Line>
          <Line
            hint={
              <button type="button" className="pc-run" onClick={run}>
                <Play className="size-3.5" aria-hidden="true" />
                Run
              </button>
            }
          >
            <Src>{'controller.show({ title: '}</Src>
            <span className="tok-string">
              &quot;
              <input
                className="pc-edit"
                value={title}
                size={Math.max(1, title.length)}
                maxLength={40}
                spellCheck={false}
                aria-label="Notification title"
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') run();
                }}
              />
              &quot;
            </span>
            <Src>{', kind: '}</Src>
            <button
              type="button"
              className="pc-edit-kind tok-string"
              aria-label={`Kind: ${kind}. Change`}
              onClick={() => setKind((current) => KINDS[(KINDS.indexOf(current) + 1) % KINDS.length]!)}
            >
              &quot;{kind}&quot;
            </button>
            <Src>{' });'}</Src>
          </Line>
          <div className="pc-gap" />

          <Line
            hint={
              <>
                <ColorPicker color={accent} onChange={setAccent} labels={{ open: 'Change accent' }} />
                <span className="pc-hint-value">
                  accent = <span className="tok-string">&quot;{accent}&quot;</span>
                </span>
              </>
            }
          >
            <Src>{'<ColorPicker color={accent} onChange={setAccent} />'}</Src>
          </Line>
          <Line hint={<ColorPalette colors={colors} onChange={setColors} labels={{ group: 'Palette colors' }} />}>
            <Src>{'<ColorPalette colors={colors} onChange={setColors} />'}</Src>
          </Line>
        </div>
      </div>
      <SloganSwitch id="c" index={index} onSelect={select} />
    </section>
  );
}
